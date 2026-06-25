import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

// Owner's direct WhatsApp line, shown on the landing page so organizers can
// reach a person immediately. E.164 without the "+" for the wa.me deep link.
const WHATSAPP_NUMBER = "573222497943";
const DEFAULT_MESSAGE =
  "Hola, me interesa usar Podio para cronometrar mi carrera.";

function whatsappHref(message = DEFAULT_MESSAGE) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function WhatsappGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.157 5.335 5.494 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.413c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.477-.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
    </svg>
  );
}

type WhatsappButtonProps = {
  /** Visible label. */
  label?: string;
  /** Pre-filled WhatsApp message. */
  message?: string;
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "lg";
  className?: string;
};

export function WhatsappButton({
  label = "Hablar por WhatsApp",
  message,
  variant = "default",
  size = "lg",
  className,
}: WhatsappButtonProps) {
  return (
    <a
      href={whatsappHref(message)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        buttonVariants({ variant, size }),
        variant === "default" &&
          "bg-[#25D366] text-white hover:bg-[#1ebe5b]",
        className,
      )}
    >
      <WhatsappGlyph className="size-4" />
      {label}
    </a>
  );
}
