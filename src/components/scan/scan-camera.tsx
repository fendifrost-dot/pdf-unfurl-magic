import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectDocumentQuad } from "@/lib/scan";
import { drawSourceToImageData } from "@/lib/scan/image";
import type { Quad } from "@/lib/scan";

type Props = {
  onCapture: (data: ImageData, name: string) => void;
  onCancel: () => void;
};

export function ScanCamera({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const quadRef = useRef<Quad | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let lastDetect = 0;
    let cancelled = false;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);

        const tick = (now: number) => {
          frame = requestAnimationFrame(tick);
          const v = videoRef.current;
          const svg = overlayRef.current;
          if (!v || !svg || v.videoWidth < 16) return;
          if (now - lastDetect < 140) return;
          lastDetect = now;
          try {
            const snap = drawSourceToImageData(v, v.videoWidth, v.videoHeight, 360);
            const found = detectDocumentQuad(snap);
            quadRef.current = found.quad;
            const pts = found.quad
              .map((p) => `${(p.x / snap.width) * 100},${(p.y / snap.height) * 100}`)
              .join(" ");
            const poly = svg.querySelector("polygon");
            if (poly) poly.setAttribute("points", pts);
          } catch {
            // Keep the last overlay if a frame fails.
          }
        };
        frame = requestAnimationFrame(tick);
      } catch {
        setError(
          "The camera was blocked or is not available. Import photos instead — same pipeline, still local.",
        );
      }
    };

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 16) return;
    const data = drawSourceToImageData(video, video.videoWidth, video.videoHeight);
    onCapture(data, `camera-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.jpg`);
  };

  return (
    <div className="bench-panel overflow-hidden p-3 sm:p-4">
      <div className="flex justify-center overflow-hidden rounded-md bg-black">
        <div className="relative inline-block max-w-full">
          <video
            ref={videoRef}
            playsInline
            muted
            className="block h-auto max-h-[70vh] w-auto max-w-full"
          />
          <svg
            ref={overlayRef}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <polygon
              points="8,8 92,8 92,92 8,92"
              fill="rgba(140,59,30,0.12)"
              stroke="#c26a3a"
              strokeWidth="0.8"
            />
          </svg>
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
              Asking for the camera…
            </div>
          )}
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          <X /> Cancel
        </Button>
        <Button type="button" size="lg" onClick={capture} disabled={!ready}>
          <Camera /> Capture page
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        The outline is a hint. You can drag the corners after capture. Designed so a phone camera
        can reuse this same view later.
      </p>
    </div>
  );
}
