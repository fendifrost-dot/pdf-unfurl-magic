import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDesktopApp, isStandaloneDisplay } from "@/lib/platform";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaRegister() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || isDesktopApp()) return;

    if ("serviceWorker" in navigator) {
      const register = () => {
        void navigator.serviceWorker.register("/sw.js").catch(() => {
          // SW is only for installability. Offline cache is deferred.
        });
      };
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (ios && !isStandaloneDisplay()) {
      const dismissed = sessionStorage.getItem("pdf-relief-ios-install") === "1";
      if (!dismissed) setShowIosHint(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (installEvent) {
    return (
      <div className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] right-3 z-30 max-w-[16rem] rounded-lg border border-border bg-card p-3 shadow-lift md:bottom-4">
        <p className="text-sm font-medium">Install PDF Relief</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add it to your home screen. Files still stay on this device.
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            className="min-h-11 flex-1 touch-manipulation"
            onClick={async () => {
              await installEvent.prompt();
              await installEvent.userChoice;
              setInstallEvent(null);
            }}
          >
            <Download /> Install
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 touch-manipulation"
            onClick={() => setInstallEvent(null)}
          >
            Not now
          </Button>
        </div>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] right-3 z-30 max-w-[16rem] rounded-lg border border-border bg-card p-3 shadow-lift md:hidden">
        <p className="text-sm font-medium">Add to Home Screen</p>
        <p className="mt-1 text-xs text-muted-foreground">
          In Safari, tap Share, then <strong className="text-foreground">Add to Home Screen</strong>
          .
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 min-h-11 w-full touch-manipulation"
          onClick={() => {
            sessionStorage.setItem("pdf-relief-ios-install", "1");
            setShowIosHint(false);
          }}
        >
          Got it
        </Button>
      </div>
    );
  }

  return null;
}
