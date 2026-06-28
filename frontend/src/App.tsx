import { Routes, Route, Navigate } from "react-router-dom";

import LandingPage from "./app/page";
import OnboardingPage from "./app/onboarding/page";
import OfflinePage from "./app/~offline/page";
import AppLayout from "./app/(app)/layout";

import Dashboard from "./app/(app)/dashboard/page";
import Transactions from "./app/(app)/transactions/page";
import TransactionDetail from "./app/(app)/transactions/[id]/page";
import AddPage from "./app/(app)/add/page";
import CapturePage from "./app/(app)/capture/page";
import AnalysisPage from "./app/(app)/analysis/page";
import ComparePage from "./app/(app)/compare/page";
import CategoriesPage from "./app/(app)/categories/page";
import ImportPage from "./app/(app)/import/page";
import SettingsPage from "./app/(app)/settings/page";
import SettingsProfile from "./app/(app)/settings/profile/page";
import SettingsEmail from "./app/(app)/settings/email/page";
import SettingsScheduled from "./app/(app)/settings/scheduled/page";
import SettingsSheet from "./app/(app)/settings/sheet/page";
import SettingsShortcut from "./app/(app)/settings/shortcut/page";
import SettingsData from "./app/(app)/settings/data/page";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/offline" element={<OfflinePage />} />

      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/transactions/:id" element={<TransactionDetail />} />
        <Route path="/add" element={<AddPage />} />
        <Route path="/capture" element={<CapturePage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/profile" element={<SettingsProfile />} />
        <Route path="/settings/email" element={<SettingsEmail />} />
        <Route path="/settings/scheduled" element={<SettingsScheduled />} />
        <Route path="/settings/sheet" element={<SettingsSheet />} />
        <Route path="/settings/shortcut" element={<SettingsShortcut />} />
        <Route path="/settings/data" element={<SettingsData />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
