import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-5xl font-bold text-navy-800">404</p>
      <p className="mt-3 text-lg font-semibold text-navy-900">Page not found</p>
      <p className="mt-1 text-sm text-mist-500">
        The page you were looking for does not exist or has moved.
      </p>
      <Link to="/" className="btn-primary mt-6">
        Back to dashboard
      </Link>
    </div>
  )
}
