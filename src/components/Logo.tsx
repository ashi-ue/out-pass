/**
 * Khuruj brand mark.
 *
 * The supplied artwork is a full lockup (emblem + KHURUJ + خروج + tagline) on a
 * white background, so it is only safe on light surfaces. On the dark navy
 * chrome we therefore use the emblem artwork — whose white background was
 * removed — next to the wordmark set in the app's own type. `size` is the
 * rendered height of the mark either way.
 */
export function Logo({
  size = 40,
  showWordmark = true,
  variant = 'dark',
}: {
  size?: number
  showWordmark?: boolean
  variant?: 'dark' | 'light'
}) {
  const onDark = variant === 'light'

  return (
    <span className="inline-flex w-fit items-center gap-3">
      <img
        src="/khuruj-logo.png"
        alt="Khuruj logo"
        style={{ height: size, width: size }}
        className="shrink-0 object-contain"
      />
      {showWordmark ? (
        <span className="flex flex-col leading-tight">
          <span
            className={
              onDark
                ? 'text-lg font-bold text-white'
                : 'text-lg font-bold text-navy-900'
            }
          >
            Khuruj
          </span>
          <span
            className={onDark ? 'text-xs text-teal-200' : 'text-xs text-teal-700'}
            dir="rtl"
            lang="ar"
          >
            خروج
          </span>
        </span>
      ) : null}
    </span>
  )
}
