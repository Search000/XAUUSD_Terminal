import { useEffect, useRef, lazy, Suspense } from "react";
import { Toaster } from "sonner";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";

import { AdminLayout } from "@/components/layout/AdminLayout";

// Pages — lazy-loaded so each admin section ships as its own chunk instead
// of one large bundle loaded up front just to see the dashboard.
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const LicensesPage = lazy(() => import("@/pages/LicensesPage").then((m) => ({ default: m.LicensesPage })));
const UsersPage = lazy(() => import("@/pages/UsersPage").then((m) => ({ default: m.UsersPage })));
const OffersPage = lazy(() => import("@/pages/OffersPage").then((m) => ({ default: m.OffersPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ContactRequestsPage = lazy(() =>
  import("@/pages/ContactRequestsPage").then((m) => ({ default: m.ContactRequestsPage })),
);
const NotificationsPage = lazy(() =>
  import("@/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })),
);
const ActivityLogPage = lazy(() => import("@/pages/ActivityLogPage").then((m) => ({ default: m.ActivityLogPage })));
const FeedbackPage = lazy(() => import("@/pages/FeedbackPage").then((m) => ({ default: m.FeedbackPage })));
const SupportPage = lazy(() => import("@/pages/SupportPage").then((m) => ({ default: m.SupportPage })));

function RouteFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
    </div>
  );
}

const queryClient = new QueryClient();

// Clerk setup
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
  },
  variables: {
    colorPrimary: "#F59E0B",
    colorForeground: "#F1F5F9",
    colorMutedForeground: "#94A3B8",
    colorDanger: "#EF4444",
    colorBackground: "#17181C",
    colorInput: "#1C1D22",
    colorInputForeground: "#F1F5F9",
    colorNeutral: "#26272E",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#17181C] rounded-md border border-[#26272E] w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-100",
    headerSubtitle: "text-slate-400",
    socialButtonsBlockButtonText: "text-slate-100",
    formFieldLabel: "text-slate-300",
    footerActionLink: "text-amber-500 hover:text-amber-400",
    footerActionText: "text-slate-400",
    dividerText: "text-slate-500",
    identityPreviewEditButton: "text-amber-500 hover:text-amber-400",
    formFieldSuccessText: "text-green-500",
    alertText: "text-red-500",
    logoBox: "",
    logoImage: "",
    socialButtonsBlockButton: "border-[#26272E] hover:bg-[#1C1D22] text-slate-100 bg-[#17181C]",
    formButtonPrimary: "bg-amber-500 hover:bg-amber-600 text-black",
    formFieldInput: "bg-[#1C1D22] border-[#26272E] text-slate-100",
    footerAction: "",
    dividerLine: "bg-[#26272E]",
    alert: "border-red-500/20 bg-red-500/10",
    otpCodeFieldInput: "bg-[#1C1D22] border-[#26272E] text-slate-100",
    formFieldRow: "",
    main: "",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-amber-500/10 via-background to-background pointer-events-none" />
      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        <div className="mb-8 flex items-center gap-2 text-primary font-bold text-3xl tracking-tighter">
          <span className="bg-primary text-primary-foreground px-3 py-1 rounded-md text-xl">XAU</span>
          <span>TERMINAL</span>
        </div>
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-amber-500/10 via-background to-background pointer-events-none" />
      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        <div className="mb-8 flex items-center gap-2 text-primary font-bold text-3xl tracking-tighter">
          <span className="bg-primary text-primary-foreground px-3 py-1 rounded-md text-xl">XAU</span>
          <span>TERMINAL</span>
        </div>
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkAuthTokenSetter() {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Admin Authorization",
            subtitle: "Enter terminal credentials",
          },
        },
        signUp: {
          start: {
            title: "Admin Authorization",
            subtitle: "Initialize terminal credentials",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ClerkAuthTokenSetter />
        <Suspense fallback={<RouteFallback />}>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            <Route path="/dashboard">
              <AdminLayout><DashboardPage /></AdminLayout>
            </Route>
            <Route path="/licenses">
              <AdminLayout><LicensesPage /></AdminLayout>
            </Route>
            <Route path="/users">
              <AdminLayout><UsersPage /></AdminLayout>
            </Route>
            <Route path="/offers">
              <AdminLayout><OffersPage /></AdminLayout>
            </Route>
            <Route path="/contact-requests">
              <AdminLayout><ContactRequestsPage /></AdminLayout>
            </Route>
            <Route path="/notifications">
              <AdminLayout><NotificationsPage /></AdminLayout>
            </Route>
            <Route path="/settings">
              <AdminLayout><SettingsPage /></AdminLayout>
            </Route>
            <Route path="/feedback">
              <AdminLayout><FeedbackPage /></AdminLayout>
            </Route>
            <Route path="/support">
              <AdminLayout><SupportPage /></AdminLayout>
            </Route>
            <Route path="/activity">
              <AdminLayout><ActivityLogPage /></AdminLayout>
            </Route>

            <Route>
              <div className="flex h-screen w-full items-center justify-center bg-background">
                <h1 className="text-xl text-muted-foreground font-mono">404 | TERMINAL ROUTE NOT FOUND</h1>
              </div>
            </Route>
          </Switch>
        </Suspense>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
      <Toaster richColors position="top-right" />
    </WouterRouter>
  );
}

export default App;
