import Image from "next/image";

/**
 * The one place the BusGuard logo image is referenced.
 *
 * Every brand lockup on the site used to draw a green tile with the letter "N"
 * in it. There is a real logo now, so all four copies of that placeholder - the
 * auth panel, the auth mobile header, the landing header and the portal sidebar
 * - render this instead, and a future change to the mark reaches all of them at
 * once rather than being made four times and missed once.
 *
 * WHY A WHITE TILE, NOT A BARE IMAGE
 * ----------------------------------
 * The mark appears on a dark green panel (`bg-brand-800`), on plain white
 * cards, and on a `white/80` scrolling header. A bare PNG would only look right
 * on whichever of those its own background happened to match. Wrapping it in a
 * fixed white rounded tile makes the contrast between the mark and its
 * surroundings the same everywhere - the same reason the letter tile it
 * replaces was white.
 *
 * `alt=""` unless a caller passes a label: the wordmark sits right beside it in
 * every lockup, so a screen reader announcing both would say the name twice.
 * Pass `label` only where the image is the *only* thing naming the link.
 */
export function BrandMark({
  size = 36,
  className = "",
  label,
}: {
  /** Rendered size in pixels, square. The asset is 512px, so it stays crisp. */
  size?: number;
  className?: string;
  /** Set only when no wordmark sits beside the mark. */
  label?: string;
}) {
  const radius = Math.round(size * 0.28);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-sm ${className}`}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <Image
        src="/logo.png"
        alt={label ?? ""}
        width={size}
        height={size}
        // The mark is above the fold on every screen that shows it, so it is
        // worth the high-priority hint rather than lazily loading.
        priority
        // One asset serves every size, so the optimizer would only be asked to
        // re-encode the same square per width.
        unoptimized
        className="h-full w-full object-contain"
      />
    </span>
  );
}
