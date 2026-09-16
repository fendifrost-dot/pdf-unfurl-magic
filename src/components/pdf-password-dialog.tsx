import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PDF_PASSWORD_INCORRECT_MESSAGE, PDF_PASSWORD_NEED_MESSAGE } from "@/lib/pdf-open";

type Props = {
  open: boolean;
  fileName: string;
  incorrect: boolean;
  busy?: boolean;
  onUnlock: (password: string) => void;
  onCancel: () => void;
};

export function PdfPasswordDialog({ open, fileName, incorrect, busy, onUnlock, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      return;
    }
    setPassword("");
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open, fileName, incorrect]);

  const submit = () => {
    if (busy) return;
    onUnlock(password);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="pdf-password-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-4" />
            This PDF is password-protected
          </DialogTitle>
          <DialogDescription>
            {PDF_PASSWORD_NEED_MESSAGE}{" "}
            {fileName ? (
              <>
                Unlock <span className="font-medium text-foreground">{fileName}</span> to view it in
                this tab.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div>
            <Label htmlFor="pdf-password-input">Password</Label>
            <Input
              ref={inputRef}
              id="pdf-password-input"
              data-testid="pdf-password-input"
              className="mt-1.5 min-h-11"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </div>
          {incorrect && (
            <Alert variant="destructive" data-testid="pdf-password-error">
              <AlertDescription>{PDF_PASSWORD_INCORRECT_MESSAGE}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" data-testid="pdf-password-unlock" disabled={busy}>
              Unlock
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
