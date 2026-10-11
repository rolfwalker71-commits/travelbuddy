import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { useAuth, AuthProvider } from "./state/auth";
import { ToastProvider } from "./ui/Toast";
import { ConfirmProvider } from "./ui/Confirm";
import { EmptyState, Spinner } from "./ui/Feedback";
import { LinkButton } from "./ui/Button";
import { LoginPage } from "./pages/Login";
import { TodayPage } from "./pages/Today";

// Jede Route ist ein eigener Chunk; Heute und Anmeldung bleiben im Hauptbündel.
const TripsPage = lazy(() => import("./pages/Trips").then((m) => ({ default: m.TripsPage })));
const TripPrintPage = lazy(() => import("./pages/TripPrint").then((m) => ({ default: m.TripPrintPage })));
const TripLayout = lazy(() => import("./pages/TripLayout").then((m) => ({ default: m.TripLayout })));
const PlanTab = lazy(() => import("./pages/trip/PlanTab").then((m) => ({ default: m.PlanTab })));
const DocumentsTab = lazy(() => import("./pages/trip/DocumentsTab").then((m) => ({ default: m.DocumentsTab })));
const LedgerTab = lazy(() => import("./pages/trip/LedgerTab").then((m) => ({ default: m.LedgerTab })));
const TeamTab = lazy(() => import("./pages/trip/TeamTab").then((m) => ({ default: m.TeamTab })));
const MapTab = lazy(() => import("./pages/trip/MapTab").then((m) => ({ default: m.MapTab })));
const EventDetailPage = lazy(() => import("./pages/trip/EventDetailPage").then((m) => ({ default: m.EventDetailPage })));
const DocumentDetailPage = lazy(() => import("./pages/DocumentDetail").then((m) => ({ default: m.DocumentDetailPage })));
const DayPage = lazy(() => import("./pages/Today").then((m) => ({ default: m.DayPage })));
const InboxPage = lazy(() => import("./pages/Inbox").then((m) => ({ default: m.InboxPage })));
const LedgerPage = lazy(() => import("./pages/LedgerPage").then((m) => ({ default: m.LedgerPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const GuestLedgerPage = lazy(() => import("./guest/GuestLedger").then((m) => ({ default: m.GuestLedgerPage })));
const GuestTripPage = lazy(() => import("./guest/GuestTrip").then((m) => ({ default: m.GuestTripPage })));

function Loading() {
  return (
    <div className="page page--center">
      <Spinner />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <Loading />;
  if (status === "anon") return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="page">
      <div className="card">
        <EmptyState icon="search" title="Seite nicht gefunden" action={<LinkButton to="/">Zur Startseite</LinkButton>}>
          Diese Adresse gibt es nicht.
        </EmptyState>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Suspense fallback={<Loading />}>
              <Routes>
                {/* Öffentlicher Gast-Bereich, ohne Anmeldung */}
                <Route path="/g/:token" element={<GuestLedgerPage />} />
                <Route path="/share/f/:token" element={<GuestLedgerPage />} />
                <Route path="/t/:token" element={<GuestTripPage />} />

                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/trips/:id/print"
                  element={
                    <RequireAuth>
                      <TripPrintPage />
                    </RequireAuth>
                  }
                />

                <Route
                  element={
                    <RequireAuth>
                      <AppShell />
                    </RequireAuth>
                  }
                >
                  <Route index element={<TodayPage />} />
                  <Route path="trips" element={<TripsPage />} />
                  <Route path="trips/:id" element={<TripLayout />}>
                    <Route index element={<PlanTab />} />
                    <Route path="documents" element={<DocumentsTab />} />
                    <Route path="ledger" element={<LedgerTab />} />
                    <Route path="team" element={<TeamTab />} />
                    <Route path="map" element={<MapTab />} />
                    <Route path="events/:eventId" element={<EventDetailPage />} />
                  </Route>
                  <Route path="trips/:id/day/:date" element={<DayPage />} />
                  <Route path="documents/:id" element={<DocumentDetailPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="ledgers/:id" element={<LedgerPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
