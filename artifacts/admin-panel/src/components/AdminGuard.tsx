import { useEffect } from "react";
import { useAuth, useClerk } from "@clerk/react";
import { useAdminGetStats, getAdminGetStatsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setLocation("/sign-in");
    }
  }, [isLoaded, isSignedIn, setLocation]);

  const { data, isLoading, isError } = useAdminGetStats({
    query: {
      queryKey: getAdminGetStatsQueryKey(),
      enabled: isLoaded && !!isSignedIn,
      retry: false
    }
  });

  if (!isLoaded || !isSignedIn || isLoading || (!data && !isError)) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground font-mono">AUTHENTICATING_TERMINAL...</p>
        </div>
      </div>
    );
  }

  // 403 or any error means not admin
  if (isError) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <svg className="h-12 w-12 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">ACCESS DENIED</h1>
            <p className="text-muted-foreground">
              This terminal is restricted to platform administrators. Your credentials do not have the required clearance level.
            </p>
          </div>
          <button 
            onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL || "/" })}
            className="rounded-md bg-primary px-6 py-2 font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
