// SVG defs for fog, blur, and ink effects.
// Rendered once inside the SVG, referenced by id everywhere.

export default function FogOfWarDefs() {
  return (
    <defs>
      {/* Fog blur for uncompleted nodes */}
      <filter id="fogBlur" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" />
        <feColorMatrix type="saturate" values="0" />
      </filter>

      {/* Ink bleed for completed nodes */}
      <filter id="inkBleed" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" xChannelSelector="R" yChannelSelector="G" />
      </filter>

      {/* Atmospheric fog overlay */}
      <filter id="atmosphericFog" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="turbulence" baseFrequency="0.012 0.018" numOctaves="3" seed="8" result="turbulence" />
        <feDisplacementMap in="SourceGraphic" in2="turbulence" scale="12" xChannelSelector="R" yChannelSelector="G" result="displaced" />
        <feGaussianBlur in="displaced" stdDeviation="8" result="blurred" />
        <feBlend in="SourceGraphic" in2="blurred" mode="normal" />
      </filter>

      {/* Paper grain texture */}
      <filter id="paperGrain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise" />
        <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise" />
        <feBlend in="SourceGraphic" in2="grayNoise" mode="multiply" result="blend" />
        <feComposite in="blend" in2="SourceGraphic" operator="in" />
      </filter>
    </defs>
  );
}
