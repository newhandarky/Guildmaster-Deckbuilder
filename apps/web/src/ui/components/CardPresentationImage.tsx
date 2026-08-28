import { useState } from 'react';
import type { PresentationViewModel } from '@guildmaster/presentation-core';

type Props = {
  art: PresentationViewModel['portraitAsset'];
  sizes: string;
  placeholderAccessible?: boolean;
};

function CardFallbackArtwork() {
  return <span className="card-fallback-scene" data-html-artwork="true" aria-hidden="true">
    <span className="card-fallback-backdrop" />
    <span className="card-fallback-orbit" />
    <span className="card-fallback-ground" />
    <span className="card-fallback-figure" />
    <span className="card-fallback-accent" />
  </span>;
}

export function CardPresentationImage({ art, sizes, placeholderAccessible = false }: Props) {
  const [failedSource, setFailedSource] = useState<string>();
  const showImage = Boolean(art.src && failedSource !== art.src);
  return <>
    <span
      className="card-art-placeholder"
      data-image-fallback={showImage ? 'hidden' : 'visible'}
      role={!showImage && placeholderAccessible ? 'img' : undefined}
      aria-label={!showImage && placeholderAccessible ? `${art.altText}（目前使用替代插畫）` : undefined}
      aria-hidden={showImage || !placeholderAccessible ? true : undefined}
    >
      <CardFallbackArtwork />
    </span>
    {showImage ? <img
      src={art.src}
      srcSet={art.srcSet}
      sizes={sizes}
      alt={art.altText}
      width={art.width}
      height={art.height}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={{ objectPosition: art.objectPosition ?? '50% 50%' }}
      onError={() => setFailedSource(art.src)}
    /> : null}
  </>;
}
