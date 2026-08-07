import { useEffect, useRef, lazy, Suspense } from "react";
import { ThemeProvider } from "next-themes";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DraggableScrollbar } from "@/components/DraggableScrollbar";
import { setAuthTokenGetter } from "@workspace/api-client-react";

// Pages — lazy-loaded so each route ships as its own chunk instead of all
// being bundled into one ~1.8MB initial download. Opening the dashboard
// no longer pulls in the trades, reports, investors, settings, etc. code.
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const TradesPage = lazy(() => import("@/pages/TradesPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const InvestorsPage = lazy(() => import("@/pages/InvestorsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const ActivatePage = lazy(() => import("@/pages/ActivatePage"));
const ScorePage = lazy(() => import("@/pages/ScorePage"));
const ExecutionPage = lazy(() => import("@/pages/ExecutionPage"));
const HelpPage = lazy(() => import("@/pages/HelpPage"));
const XauusdMonitorPage = lazy(() =>
  import("@/pages/XauusdMonitorPage").then((m) => ({ default: m.XauusdMonitorPage })),
);

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
    </div>
  );
}

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
    formFieldInputShowPasswordButton: "text-slate-400 hover:text-amber-400 transition-colors",
    formFieldInputShowPasswordIcon: "text-slate-400 hover:text-amber-400",
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
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        forceRedirectUrl={`${basePath}/activate`}
      />
    </div>
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

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
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
            title: "XAUUSD Terminal",
            subtitle: "Secure Access Required",
          },
        },
        signUp: {
          start: {
            title: "Initialize Terminal",
            subtitle: "Provision your trading environment",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <ClerkAuthTokenSetter />
          <Suspense fallback={<RouteFallback />}>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />

              {/* Protected Routes Wrapper */}
              <Route path="/activate" component={ActivatePage} />
              <Route path="/xauusd" component={XauusdMonitorPage} />
              <Route path="/dashboard" component={DashboardPage} />
              <Route path="/trades" component={TradesPage} />
              <Route path="/reports" component={ReportsPage} />
              <Route path="/investors" component={InvestorsPage} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/achievements"><Redirect to="/score" /></Route>
              <Route path="/score" component={ScorePage} />
              <Route path="/execution" component={ExecutionPage} />
              <Route path="/help" component={HelpPage} />

              <Route>
                <div className="flex min-h-screen items-center justify-center">
                  <h1 className="text-xl text-slate-400 font-mono">404 | NOT FOUND</h1>
                </div>
              </Route>
            </Switch>
          </Suspense>
          <Toaster />
          <DraggableScrollbar />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
