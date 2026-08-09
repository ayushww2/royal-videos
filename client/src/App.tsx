import { Route, Routes } from "react-router-dom";
import { RequireAuth } from "./components/RequireAuth";
import { DashboardPage } from "./pages/DashboardPage";
import { NewJobPage } from "./pages/NewJobPage";
import { JobsPage } from "./pages/JobsPage";
import { JobStatusPage } from "./pages/JobStatusPage";
import { SceneReviewPage } from "./pages/SceneReviewPage";
import { SceneReviewHomePage } from "./pages/SceneReviewHomePage";
import { TimelineEditorPage } from "./pages/TimelineEditorPage";
import { VisualLibraryPage } from "./pages/VisualLibraryPage";
import { RenderPage } from "./pages/RenderPage";
import { RenderQueuePage } from "./pages/RenderQueuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { MediaLibraryPage } from "./pages/MediaLibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { RoyalBulkDashboardPage } from "./pages/RoyalBulkDashboardPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/new" element={<NewJobPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:jobId" element={<JobStatusPage />} />
        <Route path="/jobs/:jobId/scenes" element={<SceneReviewPage />} />
        <Route path="/jobs/:jobId/timeline" element={<TimelineEditorPage />} />
        <Route path="/jobs/:jobId/library" element={<VisualLibraryPage />} />
        <Route path="/jobs/:jobId/render" element={<RenderPage />} />
        <Route path="/scene-review" element={<SceneReviewHomePage />} />
        <Route path="/render-queue" element={<RenderQueuePage />} />
        <Route path="/library" element={<MediaLibraryPage />} />
        <Route path="/royal-v2/bulk" element={<RoyalBulkDashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
