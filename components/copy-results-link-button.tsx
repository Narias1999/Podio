"use client";

// Race-level "share public results" control for the manage screen. Copies the
// public results URL to the clipboard so the organizer can paste it anywhere
// (WhatsApp, social, etc.). The public results page only exists for
// published/completed races, so the manage page only renders this then.

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function CopyResultsLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // Build from the current origin so it works in any environment (localhost,
    // preview, production) without hardcoding a base URL.
    const url = `${window.location.origin}/races/${slug}/results`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Enlace de resultados copiado.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar el enlace. Cópialo manualmente.");
    }
  };

  return (
    <Button type="button" variant="outline" onClick={handleCopy}>
      {copied ? (
        <Check className="size-4" />
      ) : (
        <Share2 className="size-4" />
      )}
      Compartir resultados
    </Button>
  );
}
