// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ErrorBoundary, Loading, useMedplum, useMedplumProfile } from '@medplum/react';
import {
  IconChartBar,
  IconClipboardList,
  IconLayoutDashboard,
  IconPill,
  IconSettings,
  IconStethoscope,
} from '@tabler/icons-react';
import { Suspense } from 'react';
import type { JSX } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { PatientHistory } from './components/PatientHistory';
import { PatientMedications } from './components/PatientMedications';
import { PatientOverview } from './components/PatientOverview';
import { Timeline } from './components/Timeline';
import { AddMedicationPage } from './pages/capture/AddMedicationPage';
import { CaptureSessionPage } from './pages/capture/CaptureSessionPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { CreatePatientPage } from './pages/CreatePatientPage';
import { HomePage } from './pages/HomePage';
import { LandingPage } from './pages/LandingPage';
import { PatientPage } from './pages/PatientPage';
import { ResourcePage } from './pages/ResourcePage';
import { SignInPage } from './pages/SignInPage';

const FULL_SCREEN_ROUTE = /^\/Patient\/[^/]+\/capture\/?$/;

export function App(): JSX.Element | null {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const location = useLocation();

  if (medplum.isLoading()) {
    return null;
  }

  const routes = (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={profile ? <HomePage /> : <LandingPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/Patient/new" element={<CreatePatientPage />} />
          <Route path="/Patient/:id" element={<PatientPage />}>
            <Route index element={<PatientOverview />} />
            <Route path="overview" element={<PatientOverview />} />
            <Route path="medications" element={<PatientMedications />} />
            <Route path="timeline" element={<Timeline />} />
            <Route path="history" element={<PatientHistory />} />
          </Route>
          <Route path="/Patient/:id/capture" element={<CaptureSessionPage />} />
          <Route path="/Patient/:id/MedicationRequest/new" element={<AddMedicationPage />} />
          <Route
            path="/dashboard"
            element={
              <ComingSoonPage
                title="Dashboard"
                description="An at-a-glance summary across all patients — open reconciliation issues, recent sessions, and follow-ups."
                icon={IconLayoutDashboard}
              />
            }
          />
          <Route
            path="/medications"
            element={
              <ComingSoonPage
                title="Medications"
                description="An organization-wide medication list and formulary view across all patients."
                icon={IconPill}
              />
            }
          />
          <Route
            path="/tasks"
            element={
              <ComingSoonPage
                title="Tasks"
                description="Follow-up tasks generated from reconciliation sessions that need prescriber sign-off."
                icon={IconClipboardList}
              />
            }
          />
          <Route
            path="/care-coordination"
            element={
              <ComingSoonPage
                title="Care Coordination"
                description="Referrals and outreach workflows shared across the care team."
                icon={IconStethoscope}
              />
            }
          />
          <Route
            path="/reports"
            element={
              <ComingSoonPage
                title="Reports"
                description="Trends across reconciliation sessions — duplicate rates, unresolved captures, and more."
                icon={IconChartBar}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <ComingSoonPage
                title="Settings"
                description="Project preferences, integrations, and team management."
                icon={IconSettings}
              />
            }
          />
          <Route path="/:resourceType/:id" element={<ResourcePage />} />
          <Route path="/:resourceType/:id/_history/:versionId" element={<ResourcePage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );

  if (!profile || FULL_SCREEN_ROUTE.test(location.pathname)) {
    return routes;
  }

  return <AppLayout>{routes}</AppLayout>;
}
