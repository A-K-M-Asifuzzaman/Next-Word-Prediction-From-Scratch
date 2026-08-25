"use client";

import { createClient } from "./supabase/client";

export type TelemetryEvent = {
  document_id: string | null;
  model_id: string | null;
  latency_ms: number;
  context_tokens: number;
  top1_token: string | null;
  top1_prob: number | null;
  entropy: number | null;
  accepted: boolean;
  accepted_rank: number | null;
  chars_saved: number;
  source: "browser" | "api";
};

/**
 * Batching telemetry buffer.
 *
 * One row per suggestion that actually settled on screen, flushed in batches.
 * Writing each event immediately would mean a network round trip per keystroke;
 * sampling instead would bias the acceptance rate, which is the number the
 * whole dashboard is built on. Batching keeps the data complete and the
 * request count low.
 */
class Telemetry {
  private queue: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private userId: string | null = null;
  private enabled = true;

  configure(userId: string | null, enabled: boolean) {
    this.userId = userId;
    this.enabled = enabled;
    if (typeof window !== "undefined" && !this.bound) {
      this.bound = true;
      // pagehide is the reliable one on mobile Safari; visibilitychange
      // covers tab switches that never fire unload. Both take the keepalive
      // path, since either may be the last moment this page gets to run code.
      window.addEventListener("pagehide", () => void this.flush(true));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void this.flush(true);
      });
    }
  }

  private bound = false;

  record(ev: TelemetryEvent) {
    if (!this.enabled || !this.userId) return;
    this.queue.push(ev);
    if (this.queue.length >= 40) {
      void this.flush();
      return;
    }
    this.timer ??= setTimeout(() => void this.flush(), 10_000);
  }

  /** Mark the most recent matching suggestion as accepted, in place. */
  markAccepted(rank: number, charsSaved: number) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (!this.queue[i].accepted) {
        this.queue[i].accepted = true;
        this.queue[i].accepted_rank = rank;
        this.queue[i].chars_saved = charsSaved;
        return;
      }
    }
  }

  /**
   * @param unloading true when the page is going away. A normal awaited insert
   * is cancelled the moment navigation commits, which silently loses the whole
   * session's events -- so the unload path uses fetch(keepalive), which the
   * browser is obliged to finish after the document is gone. sendBeacon can't
   * be used here because it cannot set the Authorization header.
   */
  async flush(unloading = false) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.queue.length || !this.userId || !this.enabled) return;

    const batch = this.queue.splice(0, this.queue.length);
    const rows = batch.map((e) => ({ ...e, user_id: this.userId }));

    try {
      const supabase = createClient();

      if (unloading) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;

        const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        await fetch(`${url}/rest/v1/prediction_events`, {
          method: "POST",
          keepalive: true,
          headers: {
            apikey: key,
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(rows),
        });
        return;
      }

      await supabase.from("prediction_events").insert(rows);
    } catch {
      // Telemetry is never allowed to break the writing experience. Dropping
      // a batch is strictly better than surfacing an error mid-sentence.
    }
  }
}

export const telemetry = new Telemetry();
