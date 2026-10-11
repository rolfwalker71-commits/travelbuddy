import { Sheet } from "./Sheet";
import { MediaImage } from "./MediaImage";

/** Bild gross ansehen (Klick auf die kleine Vorschau). */
export function ImageLightbox({ open, onClose, src, title }: { open: boolean; onClose: () => void; src: string | null | undefined; title: string }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} size="l">
      <div className="lightbox">
        <MediaImage src={src} variant="full" alt={title} lazy={false} />
      </div>
    </Sheet>
  );
}
