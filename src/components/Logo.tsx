export function Logo({
  size = 40,
  showWordmark = true,
  variant = 'dark',
}: {
  size?: number
  showWordmark?: boolean
  variant?: 'dark' | 'light'
}) {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/khuruj-logo.png"
        alt="Khuruj logo"
        width={size}
        height={size}
        className="rounded-lg object-contain"
      />
      {showWordmark ? (
        <div className="leading-tight">
          <p
            className={
              variant === 'light'
                ? 'text-lg font-bold text-white'
                : 'text-lg font-bold text-navy-900'
            }
          >
            Khuruj
          </p>
          <p
            className={
              variant === 'light'
                ? 'text-xs text-teal-200'
                : 'text-xs text-teal-700'
            }
            dir="rtl"
            lang="ar"
          >
            خروج
          </p>
        </div>
      ) : null}
    </div>
  )
}
