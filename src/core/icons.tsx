import type { ReactNode } from 'react';

type P = { size?: number };

const svg = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);

export const IconPlay = ({ size = 20 }: P) => svg(size, <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />);
export const IconPause = ({ size = 20 }: P) =>
  svg(size, <><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></>);
export const IconNext = ({ size = 18 }: P) =>
  svg(size, <><path d="M5 6.2v11.6a.9.9 0 0 0 1.4.75l8.3-5.8a.9.9 0 0 0 0-1.5L6.4 5.45A.9.9 0 0 0 5 6.2z" /><rect x="16.5" y="5" width="2.6" height="14" rx="1" /></>);
export const IconPrev = ({ size = 18 }: P) =>
  svg(size, <><path d="M19 6.2v11.6a.9.9 0 0 1-1.4.75l-8.3-5.8a.9.9 0 0 1 0-1.5l8.3-5.8A.9.9 0 0 1 19 6.2z" /><rect x="4.9" y="5" width="2.6" height="14" rx="1" /></>);
export const IconMusic = ({ size = 22 }: P) =>
  svg(size, <path d="M9 17.5V6.3a1 1 0 0 1 .76-.97l9-2.25A1 1 0 0 1 20 4.05V15.5a3 3 0 1 1-2-2.83V7.3l-7 1.75v8.45a3 3 0 1 1-2-2.83z" />);
export const IconGear = ({ size = 15 }: P) =>
  svg(
    size,
    <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6a.5.5 0 0 0 .12-.64l-1.9-3.3a.5.5 0 0 0-.6-.22l-2.4.96a7.3 7.3 0 0 0-1.7-1L14.5 2.6a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.36 2.55a7.3 7.3 0 0 0-1.7 1l-2.4-.96a.5.5 0 0 0-.6.22L2.7 8.7a.5.5 0 0 0 .12.64l2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.12.64l1.9 3.3a.5.5 0 0 0 .6.22l2.4-.96c.53.4 1.1.74 1.7 1l.36 2.55a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.36-2.55c.6-.26 1.17-.6 1.7-1l2.4.96a.5.5 0 0 0 .6-.22l1.9-3.3a.5.5 0 0 0-.12-.64zM12.1 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />,
  );
export const IconBack = ({ size = 15 }: P) =>
  svg(size, <path d="M15.4 5.4a1 1 0 0 1 0 1.4L10.2 12l5.2 5.2a1 1 0 1 1-1.4 1.4l-5.9-5.9a1 1 0 0 1 0-1.4l5.9-5.9a1 1 0 0 1 1.4 0z" />);
export const IconVolume = ({ size = 16, level = 1, muted = false }: P & { level?: number; muted?: boolean }) =>
  svg(
    size,
    <>
      <path d="M4 9.2v5.6a1 1 0 0 0 1 1h2.6l4 3.4a.9.9 0 0 0 1.5-.7V5.5a.9.9 0 0 0-1.5-.7l-4 3.4H5a1 1 0 0 0-1 1z" />
      {muted ? (
        <path d="M16.3 9.3a.9.9 0 0 1 1.3 0l1.4 1.4 1.4-1.4a.9.9 0 1 1 1.3 1.3L20.3 12l1.4 1.4a.9.9 0 1 1-1.3 1.3L19 13.3l-1.4 1.4a.9.9 0 1 1-1.3-1.3l1.4-1.4-1.4-1.4a.9.9 0 0 1 0-1.3z" />
      ) : (
        <>
          {level > 0 && <path d="M15.6 9.2a.9.9 0 0 1 1.27.1 4.2 4.2 0 0 1 0 5.4.9.9 0 1 1-1.37-1.17 2.4 2.4 0 0 0 0-3.06.9.9 0 0 1 .1-1.27z" />}
          {level > 0.5 && <path d="M18.2 6.6a.9.9 0 0 1 1.27.06 8 8 0 0 1 0 10.68.9.9 0 1 1-1.33-1.21 6.2 6.2 0 0 0 0-8.26.9.9 0 0 1 .06-1.27z" />}
        </>
      )}
    </>,
  );
export const IconChevron = ({ size = 12, open = false }: P & { open?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }}>
    <path d="M5.3 8.8a1 1 0 0 1 1.4 0L12 14.1l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4z" />
  </svg>
);
