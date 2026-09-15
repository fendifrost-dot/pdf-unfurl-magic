import { useEffect, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canOfferShare, saveBytes, shareBytes, type ExportBytes } from "@/lib/file-export";

type Props = {
  bytes: ExportBytes;
  filename: string;
  disabled?: boolean;
  compact?: boolean;
};

export function FileActions({ bytes, filename, disabled, compact }: Props) {
  const [shareReady, setShareReady] = useState(false);

  useEffect(() => {
    setShareReady(canOfferShare());
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size={compact ? "sm" : "default"}
        variant="secondary"
        className="min-h-11 touch-manipulation"
        disabled={disabled}
        onClick={() => void saveBytes(bytes, filename)}
      >
        <Download /> Save
      </Button>
      {shareReady && (
        <Button
          size={compact ? "sm" : "default"}
          variant="outline"
          className="min-h-11 touch-manipulation"
          disabled={disabled}
          onClick={() => void shareBytes(bytes, filename)}
        >
          <Share2 /> Share
        </Button>
      )}
    </div>
  );
}
