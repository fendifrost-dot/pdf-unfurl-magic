import { useRef, useState, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { isDesktopApp, pickDesktopPdf, pickDesktopPdfs } from "@/lib/desktop";

type Props = {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  title: string;
  hint: string;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
};

function toFile(picked: { name: string; bytes: Uint8Array }): File {
  return new File([picked.bytes.slice(0) as unknown as BlobPart], picked.name, {
    type: "application/pdf",
  });
}

export function PdfDropZone({
  onFiles,
  multiple = false,
  title,
  hint,
  children,
  className,
  disabled,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = (list: FileList | null) => {
    if (!list) return;
    const pdfs = Array.from(list).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfs.length) onFiles(multiple ? pdfs : pdfs.slice(0, 1));
  };

  const choose = async () => {
    // Desktop app: use the real Open dialog instead of the hidden file input.
    if (isDesktopApp()) {
      if (multiple) {
        const picked = await pickDesktopPdfs();
        if (picked?.length) onFiles(picked.map(toFile));
      } else {
        const picked = await pickDesktopPdf();
        if (picked) onFiles([toFile(picked)]);
      }
      return;
    }
    inputRef.current?.click();
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) accept(e.dataTransfer.files);
      }}
      className={cn(
        "relative rounded-lg border-2 border-dashed border-border bg-background/40 p-8 text-center transition-colors",
        dragging && "border-primary bg-primary/5",
        disabled && "opacity-60",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-secondary text-primary">
          <FileUp className="size-5" />
        </span>
        <div>
          <p className="font-display text-base font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void choose()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none"
        >
          Choose {multiple ? "PDFs" : "a PDF"}
        </button>
        {children}
      </div>
    </div>
  );
}
