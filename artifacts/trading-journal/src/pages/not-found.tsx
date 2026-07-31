import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-full max-w-md mx-4 border border-border rounded-lg bg-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="h-8 w-8 text-red-500 shrink-0" />
          <h1 className="text-lg font-bold text-white font-mono tracking-tight">
            404 — Not Found
          </h1>
        </div>
        <p className="text-sm text-muted-foreground font-mono">
          The page you're looking for doesn't exist or has been moved.
        </p>
      </div>
    </div>
  );
}
