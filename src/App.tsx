import { AlertTriangle, LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type AlertRecord, type DashboardData, type DocumentRecord, type InsuranceInput, type InsurancePolicy, type MaintenanceInput, type MaintenanceRecord, type MileageEntry, type MileageInput, type Part, type PartInput, type Project, type ProjectInput, type ReferenceSpec, type Reminder, type ReminderInput, type ServicePlan, type ServicePlanInput, type SpecInput, type Vehicle, type VehicleInput, type VehicleUpdateInput } from "./api";
import { MileageDialog, ServicePlanDialog, VehicleDialog } from "./components/GarageDialogs";
import { DocumentDialog, ProjectDialog, ReminderDialog, SpecDialog, VehicleDeleteDialog, VehicleEditDialog } from "./components/ManagementDialogs";
import { InsuranceDialog } from "./components/InsuranceDialog";
import { MaintenanceDialog } from "./components/MaintenanceDialog";
import { PartDialog } from "./components/PartDialog";
import { GarageCalculators } from "./components/GarageCalculators";
import { DashboardPlaceholder, DocumentsView, InsuranceView, MaintenanceView, PartsView, ProjectsView, SettingsView, SpecsView, VehiclesView } from "./components/ModuleViews";
import { SecondaryPanels } from "./components/SecondaryPanels";
import { MobileNav, Sidebar, type Section } from "./components/Sidebar";
import { StatusStrip } from "./components/StatusStrip";
import { Topbar, vehicleLabel } from "./components/Topbar";
import { VehicleSummary } from "./components/VehicleSummary";

export default function App() {
  const pathSection = window.location.pathname.slice(1) as Section;
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [vehicleParts, setVehicleParts] = useState<Part[]>([]);
  const [garageParts, setGarageParts] = useState<Part[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [insurancePolicies, setInsurancePolicies] = useState<InsurancePolicy[]>([]);
  const [mileage, setMileage] = useState<MileageEntry[]>([]);
  const [servicePlans, setServicePlans] = useState<ServicePlan[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [specs, setSpecs] = useState<ReferenceSpec[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [section, setSection] = useState<Section>(["dashboard","maintenance","parts","specs","projects","documents","insurance","calculators","vehicles","settings"].includes(pathSection) ? pathSection : "dashboard");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [partsLoading, setPartsLoading] = useState(false);
  const parts = section === "parts" ? garageParts : vehicleParts;
  const loadGeneration = useRef(0);
  const [, setPreferenceVersion] = useState(0);
  const [error, setError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMaintenance, setEditingMaintenance] = useState<MaintenanceRecord | null>(null);
  const [maintenancePrefill, setMaintenancePrefill] = useState<Partial<MaintenanceInput> | null>(null);
  const [dueToClear, setDueToClear] = useState<number | null>(null);
  const [vehicleDialogOpen, setVehicleDialogOpen] = useState(false);
  const [mileageDialogOpen, setMileageDialogOpen] = useState(false);
  const [editingMileage, setEditingMileage] = useState<MileageEntry | null>(null);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ServicePlan | null>(null);
  const [planPrefill, setPlanPrefill] = useState<Partial<ServicePlanInput> | null>(null);
  const [convertingFollowUpId, setConvertingFollowUpId] = useState<number | null>(null);
  const [vehicleEditOpen, setVehicleEditOpen] = useState(false);
  const [vehicleToDelete, setVehicleToDelete] = useState<Vehicle | null>(null);
  const [specDialogOpen, setSpecDialogOpen] = useState(false);
  const [editingSpec, setEditingSpec] = useState<ReferenceSpec | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<DocumentRecord | null>(null);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [partDialogOpen, setPartDialogOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [insuranceDialogOpen, setInsuranceDialogOpen] = useState(false);
  const [editingInsurance, setEditingInsurance] = useState<InsurancePolicy | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [density, setDensity] = useState<"comfortable" | "compact">(() => localStorage.getItem("sumplog-density") === "compact" ? "compact" : "comfortable");
  const [navigationCollapsed, setNavigationCollapsed] = useState(() => localStorage.getItem("sumplog-navigation-collapsed") === "true");

  useEffect(() => {
    localStorage.setItem("sumplog-density", density);
  }, [density]);
  useEffect(() => {
    localStorage.setItem("sumplog-navigation-collapsed", String(navigationCollapsed));
  }, [navigationCollapsed]);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [section]);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  const navigate = useCallback((next: Section, replace = false) => {
    setSection(next);
    const url = new URL(window.location.href); url.pathname = next === "dashboard" ? "/" : `/${next}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  }, []);

  useEffect(() => {
    const onPop = () => { const value = window.location.pathname.slice(1) as Section; setSection(["dashboard","maintenance","parts","specs","projects","documents","insurance","calculators","vehicles","settings"].includes(value) ? value : "dashboard"); const id = Number(new URL(window.location.href).searchParams.get("vehicle")); if (Number.isInteger(id) && id > 0) setVehicleId(id); };
    window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadVehicle = useCallback(async (id: number) => {
    const generation = ++loadGeneration.current;
    setDashboard((current) => current?.vehicle.id === id ? current : null);
    setLoading(true);
    setError("");
    try {
      const [dashboardData, partData, maintenanceData, documentData, mileageData, planData, reminderData, specData, projectData, alertData] = await Promise.all([
        api.dashboard(id),
        api.parts(id),
        api.maintenance(id),
        api.documents(),
        api.mileage(id),
        api.servicePlans(id),
        api.reminders(id),
        api.specs(id),
        api.projects(id),
        api.alerts(id),
      ]);
      if (generation !== loadGeneration.current) return;
      setDashboard(dashboardData);
      setVehicles((current) => current.map((vehicle) => vehicle.id === id ? dashboardData.vehicle : vehicle));
      setVehicleParts(partData);
      setMaintenance(maintenanceData);
      setDocuments(documentData);
      setMileage(mileageData);
      setServicePlans(planData);
      setReminders(reminderData);
      setSpecs(specData);
      setProjects(projectData);
      setAlerts(alertData);
    } catch (cause) {
      if (generation === loadGeneration.current) setError(cause instanceof Error ? cause.message : "SumpLog could not load this vehicle.");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  const loadGarageParts = useCallback(async () => {
    setPartsLoading(true);
    try {
      setGarageParts(await api.parts());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SumpLog could not load the parts catalogue.");
    } finally {
      setPartsLoading(false);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true); setError(""); setDashboard(null); setVehicleId(null); loadGeneration.current++;
    try {
      const auth = await api.authStatus(); setAuthRequired(auth.required); setAuthenticated(auth.authenticated); setAuthChecked(true);
      if (!auth.authenticated) { setLoading(false); return; }
      const [rows, policies, partRows, documentRows] = await Promise.all([api.vehicles(), api.insurance(), api.parts(), api.documents()]); setVehicles(rows); setInsurancePolicies(policies); setGarageParts(partRows); setDocuments(documentRows);
      const requested = Number(new URL(window.location.href).searchParams.get("vehicle"));
      const selected = rows.find((row) => row.id === requested) ?? rows[0];
      if (selected) setVehicleId(selected.id); else setLoading(false);
    } catch (cause) { setAuthChecked(true); setError(cause instanceof Error ? cause.message : "SumpLog could not load your garage."); setLoading(false); }
  }, []);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (vehicleId) void loadVehicle(vehicleId);
  }, [vehicleId, loadVehicle]);

  useEffect(() => {
    if (authenticated && section === "parts") void loadGarageParts();
  }, [authenticated, section, loadGarageParts]);

  useEffect(() => {
    if (authenticated && section === "dashboard" && vehicleId) {
      void loadVehicle(vehicleId);
      void loadGarageParts();
    }
  }, [authenticated, section, vehicleId, loadVehicle, loadGarageParts]);

  useEffect(() => {
    const refreshPhotos = () => { if (vehicleId) { void loadVehicle(vehicleId); void api.vehicles().then(setVehicles); } else void api.documents().then(setDocuments); };
    window.addEventListener("sumplog:photos-changed", refreshPhotos);
    return () => window.removeEventListener("sumplog:photos-changed", refreshPhotos);
  }, [vehicleId, loadVehicle]);

  const visibleParts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? parts.filter((part) => [part.partNumber, part.name, part.manufacturer, part.storageLocation, part.supplierName].some((value) => value?.toLowerCase().includes(term))) : parts;
  }, [parts, query]);

  useEffect(() => {
    const onPreferences = () => setPreferenceVersion((value) => value + 1);
    const onUnauthorized = () => { loadGeneration.current++; setDashboard(null); setVehicleId(null); setAuthenticated(false); setAuthRequired(true); setAuthChecked(true); setLoading(false); };
    window.addEventListener("sumplog:preferences", onPreferences); window.addEventListener("sumplog:unauthorized", onUnauthorized);
    return () => { window.removeEventListener("sumplog:preferences", onPreferences); window.removeEventListener("sumplog:unauthorized", onUnauthorized); };
  }, []);

  useEffect(() => {
    if (!vehicleId) return; const url = new URL(window.location.href); url.searchParams.set("vehicle", String(vehicleId)); window.history.replaceState({}, "", url);
  }, [vehicleId]);

  const refreshVehicles = async (selectedId?: number) => {
    const rows = await api.vehicles();
    setVehicles(rows);
    setVehicleId(selectedId ?? rows[0]?.id ?? null);
    return rows;
  };
  const refreshInsurance = async () => setInsurancePolicies(await api.insurance());

  const openNewMaintenance = () => { setEditingMaintenance(null); setMaintenancePrefill(null); setDueToClear(null); setDialogOpen(true); };
  const openMaintenance = (record: MaintenanceRecord) => { setEditingMaintenance(record); setMaintenancePrefill(null); setDueToClear(null); setDialogOpen(true); };
  const logScheduledService = (service: MaintenanceRecord) => { setEditingMaintenance(null); setMaintenancePrefill({ title: service.title, category: service.category, mileage: dashboard?.vehicle.mileage }); setDueToClear(service.id); setDialogOpen(true); };
  const removeScheduledService = async (service: MaintenanceRecord) => { if (!vehicleId || service.id <= 0) return; if (!window.confirm(`Remove ${service.title} from next services? Its maintenance history will be kept.`)) return; await api.clearMaintenanceDue(service.id); await loadVehicle(vehicleId); setAnnouncement(`${service.title} was removed from next services; its maintenance history was kept.`); };

  const saveMaintenance = async (input: MaintenanceInput, attachments: import("./api").MaintenanceAttachment[], documentIds: number[]) => {
    if (!vehicleId) return;
    const payload = { ...input, ...(!editingMaintenance && dueToClear ? { dueSourceId: dueToClear } : {}) };
    const saved = attachments.length ? await api.saveMaintenanceBundle(vehicleId, editingMaintenance?.id ?? null, payload, attachments) : editingMaintenance ? await api.updateMaintenance(editingMaintenance.id, payload) : await api.addMaintenance(vehicleId, payload);
    const eligibleDocuments = documents.filter((document) => document.vehicleId === vehicleId && !document.insurancePolicyId);
    for (const document of eligibleDocuments) {
      const currentIds = document.maintenanceIds ?? (document.maintenanceId ? [document.maintenanceId] : []);
      const currentlyLinked = currentIds.includes(saved.id), shouldBeLinked = documentIds.includes(document.id);
      if (currentlyLinked === shouldBeLinked) continue;
      await api.updateDocument(document.id, { name: document.name, notes: document.notes ?? undefined, kind: document.kind, vehicleId: document.vehicleId, maintenanceIds: shouldBeLinked ? [...new Set([...currentIds, saved.id])] : currentIds.filter((id) => id !== saved.id), projectId: document.projectId ?? null });
    }
    setMaintenancePrefill(null); setDueToClear(null);
    await loadVehicle(vehicleId);
    setAnnouncement(`${input.title} was ${editingMaintenance ? "updated" : "added"}${attachments.length || documentIds.length ? ` with ${attachments.length + documentIds.length} attachment${attachments.length + documentIds.length === 1 ? "" : "s"}` : ""}.`);
  };

  const addVehicle = async (input: VehicleInput) => { const saved = await api.addVehicle(input); await refreshVehicles(saved.id); await loadVehicle(saved.id); setAnnouncement(`${saved.year} ${saved.make} ${saved.model} was added.`); };
  const saveMileage = async (input: MileageInput) => { if (!vehicleId) return; if (editingMileage) await api.updateMileage(editingMileage.id, input); else await api.addMileage(vehicleId, input); await refreshVehicles(vehicleId); await loadVehicle(vehicleId); setAnnouncement("Mileage and yearly estimate were updated."); };
  const openNewPlan = () => { setEditingPlan(null); setPlanPrefill(null); setConvertingFollowUpId(null); setPlanDialogOpen(true); };
  const openPlan = (plan: ServicePlan) => { setEditingPlan(plan); setPlanPrefill(null); setConvertingFollowUpId(null); setPlanDialogOpen(true); };
  const convertFollowUp = (record: MaintenanceRecord) => { setEditingPlan(null); setPlanPrefill({ title: record.title, category: record.category, nextDueMileage: record.nextDueMileage, nextDueDate: record.nextDueDate, items: [], createReminder: true, vehicleIds: vehicleId ? [vehicleId] : [] }); setConvertingFollowUpId(record.id); setPlanDialogOpen(true); };
  const savePlan = async (input: ServicePlanInput & { active?: boolean }) => { if (!vehicleId) return; if (editingPlan) await api.updateServicePlan(editingPlan.id, { ...input, active: input.active ?? editingPlan.active }); else { await api.addServicePlan(vehicleId, { ...input, ...(convertingFollowUpId ? { sourceMaintenanceId: convertingFollowUpId } : {}) }); } setPlanPrefill(null); setConvertingFollowUpId(null); await loadVehicle(vehicleId); setAnnouncement(`${input.title} was ${editingPlan ? "updated" : "added"}.`); };
  const deletePlan = async (plan: ServicePlan) => { if (!vehicleId) return; await api.deleteServicePlan(plan.id); setPlanDialogOpen(false); await loadVehicle(vehicleId); setAnnouncement(`${plan.title} was deleted.`); };
  const changeReminder = async (id: number, status: Reminder["status"]) => { if (!vehicleId) return; await api.updateReminder(id, status); await loadVehicle(vehicleId); setAnnouncement(`Reminder marked ${status.toLowerCase()}.`); };
  const changeVehiclePhoto = async (id: number, file: File) => { await api.uploadVehicleImage(id, file); await refreshVehicles(id); await loadVehicle(id); setAnnouncement("Vehicle photo updated."); };
  const removeVehiclePhoto = async (id: number) => { await api.removeVehicleImage(id); await refreshVehicles(id); await loadVehicle(id); setAnnouncement("Vehicle photo removed."); };
  const setMaintenanceVoided = async (record: MaintenanceRecord, voided: boolean) => { if (!vehicleId) return; try { await api.setMaintenanceVoided(record.id, voided); await loadVehicle(vehicleId); setAnnouncement(`${record.title} was ${voided ? "voided" : "restored"}.`); } catch (cause) { setError(cause instanceof Error ? cause.message : "Maintenance status could not be changed."); } };
  const saveVehicle = async (input: VehicleUpdateInput) => { if (!vehicleId) return; await api.updateVehicle(vehicleId, input); await refreshVehicles(vehicleId); await loadVehicle(vehicleId); setAnnouncement("Vehicle details updated."); };
  const deleteVehicle = async (vehicle: Vehicle) => {
    await api.deleteVehicle(vehicle.id);
    // The delete succeeded: update locally so a follow-up fetch cannot report it as a failed deletion.
    const rows = vehicles.filter((row) => row.id !== vehicle.id);
    const nextVehicle = rows.find((row) => row.id === vehicleId) ?? rows[0];
    loadGeneration.current++;
    setVehicleEditOpen(false);
    setVehicleToDelete(null);
    if (vehicle.id === vehicleId || !nextVehicle) {
      setDashboard(null);
      setVehicleParts([]); setMaintenance([]); setDocuments(await api.documents()); setMileage([]); setServicePlans([]); setReminders([]); setSpecs([]); setProjects([]); setAlerts([]);
    }
    setVehicles(rows);
    await Promise.all([refreshInsurance(), loadGarageParts()]);
    setAnnouncement(`${vehicle.year} ${vehicle.make} ${vehicle.model} and its associated records were deleted.`);
    if (nextVehicle) {
      setVehicleId(nextVehicle.id);
      await loadVehicle(nextVehicle.id);
    } else {
      setVehicleId(null);
      setLoading(false);
      const url = new URL(window.location.href); url.searchParams.delete("vehicle"); window.history.replaceState({}, "", url);
      navigate("vehicles");
    }
  };
  const openNewSpec = () => { setEditingSpec(null); setSpecDialogOpen(true); };
  const saveSpec = async (input: SpecInput) => { if (!vehicleId) return; if (editingSpec) await api.updateSpec(editingSpec.id, input); else await api.addSpec(vehicleId, input); await loadVehicle(vehicleId); setAnnouncement("Reference specification saved."); };
  const deleteSpec = async (spec: ReferenceSpec) => { if (!vehicleId) return; await api.deleteSpec(spec.id); await loadVehicle(vehicleId); setAnnouncement(`${spec.label} was deleted.`); };
  const cloneSpec = async (spec: ReferenceSpec, targetVehicleId: number) => { if (!vehicleId) return; await api.cloneSpec(spec.id, targetVehicleId); await loadVehicle(vehicleId); setAnnouncement(`${spec.label} was cloned to the selected vehicle.`); };
  const assignSpec = async (spec: ReferenceSpec, targetVehicleId: number) => { if (!vehicleId) return; await api.assignSpec(spec.id, targetVehicleId); await loadVehicle(vehicleId); setAnnouncement(`${spec.label} was assigned to the selected vehicle.`); };
  const openNewProject = () => { setEditingProject(null); setProjectDialogOpen(true); };
  const saveProject = async (input: ProjectInput) => { if (!vehicleId) return; if (editingProject) await api.updateProject(editingProject.id, input); else await api.addProject(vehicleId, input); await loadVehicle(vehicleId); setAnnouncement(`${input.title} was saved.`); };
  const deleteProject = async (project: Project) => { if (!vehicleId) return; await api.deleteProject(project.id); await loadVehicle(vehicleId); setAnnouncement(`${project.title} was deleted.`); };
  const toggleProjectTask = async (taskId: number, completed: boolean) => { if (!vehicleId) return; await api.toggleProjectTask(taskId, completed); await loadVehicle(vehicleId); };
  const openNewDocument = () => { setEditingDocument(null); setDocumentDialogOpen(true); };
  const openDocumentMaintenance = (document: DocumentRecord, maintenanceIds = document.maintenanceIds ?? (document.maintenanceId ? [document.maintenanceId] : [])) => {
    if (!maintenanceIds.length) return;
    if (document.vehicleId) setVehicleId(document.vehicleId);
    setSection("maintenance");
    const url = new URL(window.location.href);
    url.pathname = "/maintenance";
    if (document.vehicleId) url.searchParams.set("vehicle", String(document.vehicleId));
    url.searchParams.delete("record");
    url.searchParams.set("records", maintenanceIds.join(","));
    window.history.pushState({}, "", url);
  };
  const uploadDocument = async (input: { vehicleId: number; maintenanceIds: number[]; kind: string; name: string; notes?: string; file: File }) => { await api.uploadDocument(input); if (vehicleId) await loadVehicle(vehicleId); setAnnouncement(`${input.name} was uploaded and linked to ${input.maintenanceIds.length} maintenance record${input.maintenanceIds.length === 1 ? "" : "s"}.`); };
  const saveDocument = async (document: DocumentRecord, input: { notes?: string; name: string; kind: string; vehicleId: number | null; maintenanceIds: number[] }) => { await api.updateDocument(document.id, { ...input, projectId: input.vehicleId === document.vehicleId ? document.projectId : null }); setDocuments(await api.documents()); if (vehicleId) await loadVehicle(vehicleId); setAnnouncement("Document details and maintenance links updated."); };
  const deleteDocument = async (document: DocumentRecord) => { await api.deleteDocument(document.id); setDocuments(await api.documents()); if (vehicleId) await loadVehicle(vehicleId); setAnnouncement(`${document.name} was deleted.`); };
  const openNewInsurance = () => { setEditingInsurance(null); setInsuranceDialogOpen(true); };
  const saveInsurance = async (input: InsuranceInput) => { if (editingInsurance) await api.updateInsurance(editingInsurance.id, input); else await api.addInsurance(input); await refreshInsurance(); if (vehicleId) await loadVehicle(vehicleId); setAnnouncement(`Insurance policy ${editingInsurance ? "updated" : "added"}.`); };
  const deleteInsurance = async (policy: InsurancePolicy) => { await api.deleteInsurance(policy.id); await refreshInsurance(); if (vehicleId) await loadVehicle(vehicleId); setAnnouncement(`${policy.provider} insurance policy deleted.`); };
  const uploadInsuranceDocument = async (policy: InsurancePolicy, file: File) => { await api.uploadInsuranceDocument(policy.id, "Insurance", file); setDocuments(await api.documents()); if (vehicleId) await loadVehicle(vehicleId); await refreshInsurance(); setAnnouncement(`${file.name} attached to ${policy.provider}.`); };
  const openNewReminder = () => { setEditingReminder(null); setReminderDialogOpen(true); };
  const saveReminder = async (input: ReminderInput) => { if (!vehicleId) return; if (editingReminder) await api.saveReminder(editingReminder.id, input); else await api.addReminder(vehicleId, input); await loadVehicle(vehicleId); setAnnouncement(`${input.title} was saved.`); };
  const deleteReminder = async (reminder: Reminder) => { if (!vehicleId) return; await api.deleteReminder(reminder.id); await loadVehicle(vehicleId); setAnnouncement(`${reminder.title} was deleted.`); };

  const openNewPart = () => {
    setEditingPart(null);
    setPartDialogOpen(true);
  };

  const openPart = (part: Part) => {
    setEditingPart(part);
    setPartDialogOpen(true);
  };

  const refreshPartViews = async () => {
    await Promise.all([loadGarageParts(), vehicleId ? loadVehicle(vehicleId) : Promise.resolve()]);
  };

  const savePart = async (input: PartInput) => {
    const saved = editingPart ? await api.updatePart(editingPart.id, input) : await api.addPart(input);
    await refreshPartViews();
    setAnnouncement(`${saved.partNumber} was ${editingPart ? "updated" : "added"}.`);
  };

  const deletePart = async (part: Part) => {
    await api.deletePart(part.id);
    await refreshPartViews();
    setAnnouncement(`${part.partNumber} was deleted from inventory.`);
  };

  const deleteParts = async (selectedParts: Part[]) => {
    for (const part of selectedParts) await api.deletePart(part.id);
    await refreshPartViews();
    setAnnouncement(`${selectedParts.length} inventory part${selectedParts.length === 1 ? " was" : "s were"} deleted.`);
  };

  if (!authChecked || (loading && !dashboard && !(["settings", "insurance", "parts"] as Section[]).includes(section) && authenticated)) {
    return <main className="boot-state"><LoaderCircle className="spin" size={26} /><span>Opening the garage…</span></main>;
  }

  if (authRequired && !authenticated) return <LoginScreen onLogin={async (password) => { await api.login(password); setAuthenticated(true); await bootstrap(); }} />;

  if (error && !dashboard) {
    return (
      <main className="boot-state boot-state--error">
        <AlertTriangle size={28} />
        <h1>SumpLog could not start</h1>
        <p>{error}</p>
        <button className="button button--primary" onClick={() => void bootstrap()}><RefreshCcw size={17} />Retry</button>
      </main>
    );
  }

  return (
    <div className="app-shell" data-density={density} data-sidebar-collapsed={navigationCollapsed || undefined}>
      <Sidebar section={section} onSectionChange={navigate} collapsed={navigationCollapsed} onCollapsedChange={setNavigationCollapsed} />
      <div className="app-main">
        <Topbar query={query} onQueryChange={setQuery} searchVisible={["dashboard", "parts"].includes(section)} onLogMaintenance={openNewMaintenance} canLogMaintenance={Boolean(dashboard && dashboard.vehicle.id === vehicleId)} alertCount={alerts.filter((alert) => alert.severity !== "info").length} onOpenAlerts={() => navigate("vehicles")} vehicles={vehicles} vehicleId={vehicleId} onSelectVehicle={setVehicleId} showVehicleContext={!['dashboard', 'calculators'].includes(section)} vehicleLoading={loading} />
        <main className="content" id="main-content">
          {error && dashboard && <div className="error-banner" role="alert"><AlertTriangle size={18} /><span>{error}</span><button className="button button--quiet button--small" onClick={() => vehicleId && void loadVehicle(vehicleId)}>Retry</button><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
          {section === "dashboard" && vehicles.length > 1 && (
            <label className="vehicle-picker">
              <span>Selected vehicle</span>
              <select value={vehicleId ?? ""} onChange={(event) => setVehicleId(Number(event.target.value))}>
                {vehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicleLabel(vehicle)} · #{vehicle.id}</option>)}
              </select>
            </label>
          )}
          {section === "calculators" ? <GarageCalculators /> : section === "settings" ? <SettingsView density={density} onDensityChange={setDensity} authRequired={authRequired} onLogout={async () => { await api.logout(); window.location.reload(); }} onImportBackup={async (file) => { const result = await api.importBackup(file); const nextVehicles = await api.vehicles(); setVehicles(nextVehicles); setVehicleId(nextVehicles[0]?.id ?? null); if (nextVehicles.length) await loadVehicle(nextVehicles[0].id); else setDashboard(null); return result; }} /> : section === "insurance" ? <InsuranceView policies={insurancePolicies} documents={documents} onAdd={openNewInsurance} onEdit={(policy) => { setEditingInsurance(policy); setInsuranceDialogOpen(true); }} onAttach={uploadInsuranceDocument} onDeleteDocument={deleteDocument} /> : section === "documents" ? <DocumentsView documents={documents} vehicles={vehicles} onAdd={vehicles.length ? openNewDocument : () => { navigate("insurance"); setAnnouncement("Attach documents to an insurance policy, or add a vehicle for vehicle documents."); }} onEdit={(document) => { setEditingDocument(document); setDocumentDialogOpen(true); }} onOpenMaintenance={openDocumentMaintenance} /> : section === "parts" ? <PartsView parts={visibleParts} vehicles={vehicles} loading={partsLoading} onAdd={openNewPart} onEdit={openPart} onDeleteSelected={deleteParts} /> : dashboard ? (
            <ActiveSection
              section={section}
              dashboard={dashboard}
              parts={garageParts}
              partsLoading={partsLoading}
              maintenance={maintenance}
              onLogMaintenance={openNewMaintenance}
              onLogScheduledService={logScheduledService}
              onRemoveScheduledService={removeScheduledService}
              onEditMaintenance={openMaintenance}
              onAddPart={openNewPart}
              onEditPart={openPart}
              onDeleteSelected={deleteParts}
              vehicles={vehicles}
              activeVehicleId={vehicleId}
              onSelectVehicle={(id) => { setVehicleId(id); navigate("vehicles"); }}
              density={density}
              onDensityChange={setDensity}
              documents={documents}
              insurancePolicies={insurancePolicies}
              mileage={mileage}
              servicePlans={servicePlans}
              reminders={reminders}
              specs={specs}
              projects={projects}
              alerts={alerts}
              onAddVehicle={() => setVehicleDialogOpen(true)}
              onAddMileage={() => { setEditingMileage(null); setMileageDialogOpen(true); }}
              onEditMileage={(entry) => { setEditingMileage(entry); setMileageDialogOpen(true); }}
              onAddPlan={openNewPlan}
              onEditPlan={openPlan}
              onConvertFollowUp={convertFollowUp}
              onEditVehicle={() => setVehicleEditOpen(true)}
              onDeleteVehicle={setVehicleToDelete}
              onAddSpec={openNewSpec}
              onEditSpec={(spec) => { setEditingSpec(spec); setSpecDialogOpen(true); }}
              onCloneSpec={cloneSpec}
              onAssignSpec={assignSpec}
              onAddProject={openNewProject}
              onEditProject={(project) => { setEditingProject(project); setProjectDialogOpen(true); }}
              onToggleProjectTask={toggleProjectTask}
              onAddDocument={openNewDocument}
              onEditDocument={(document) => { setEditingDocument(document); setDocumentDialogOpen(true); }}
              onAddReminder={openNewReminder}
              onEditReminder={(reminder) => { setEditingReminder(reminder); setReminderDialogOpen(true); }}
              onChangePhoto={changeVehiclePhoto}
              onRemovePhoto={removeVehiclePhoto}
              onReminderStatus={changeReminder}
              onMaintenanceVoided={setMaintenanceVoided}
              onAddInsurance={openNewInsurance}
              onEditInsurance={(policy) => { setEditingInsurance(policy); setInsuranceDialogOpen(true); }}
              onAttachInsuranceDocument={uploadInsuranceDocument}
              onDeleteDocument={deleteDocument}
              onImportBackup={async (file) => { const result = await api.importBackup(file); await bootstrap(); setAnnouncement("Backup restored successfully."); return result; }}
              authRequired={authRequired}
            />
          ) : vehicles.length === 0 ? <section className="empty-module"><AlertTriangle size={28} /><h1>Your garage is empty</h1><p>Add a vehicle to begin tracking maintenance, mileage, parts fitment, and documents.</p><button className="button button--primary" onClick={() => setVehicleDialogOpen(true)}>Add vehicle</button></section> : <DashboardPlaceholder />}
        </main>
      </div>
      <MobileNav section={section} onSectionChange={navigate} />
      {dashboard && (
        <>
          <MaintenanceDialog open={dialogOpen} record={editingMaintenance} vehicle={dashboard.vehicle} parts={parts} documents={documents} onDeleteDocument={deleteDocument} prefill={maintenancePrefill} shopNames={maintenance.map((record) => record.shopName).filter((shopName): shopName is string => Boolean(shopName))} onClose={() => setDialogOpen(false)} onSubmit={saveMaintenance} />
          <MileageDialog open={mileageDialogOpen} vehicle={dashboard.vehicle} entry={editingMileage} onClose={() => setMileageDialogOpen(false)} onSubmit={saveMileage} />
          <ServicePlanDialog open={planDialogOpen} vehicle={dashboard.vehicle} vehicles={vehicles} plan={editingPlan} prefill={planPrefill} onClose={() => setPlanDialogOpen(false)} onSubmit={savePlan} onDelete={deletePlan} />
          <VehicleEditDialog open={vehicleEditOpen} vehicle={dashboard.vehicle} vehicles={vehicles} onClose={() => setVehicleEditOpen(false)} onSave={saveVehicle} onDelete={deleteVehicle} />
          <SpecDialog open={specDialogOpen} spec={editingSpec} groups={specs.map((spec) => spec.groupName)} onClose={() => setSpecDialogOpen(false)} onSave={saveSpec} onDelete={deleteSpec} />
          <ProjectDialog open={projectDialogOpen} project={editingProject} onClose={() => setProjectDialogOpen(false)} onSave={saveProject} onDelete={deleteProject} />

          <ReminderDialog open={reminderDialogOpen} reminder={editingReminder} plans={servicePlans} onClose={() => setReminderDialogOpen(false)} onSave={saveReminder} onDelete={deleteReminder} />
        </>
      )}
      <PartDialog open={partDialogOpen} part={editingPart} vehicle={dashboard?.vehicle ?? vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null} vehicles={vehicles} storageLocations={[...new Set([...garageParts, ...vehicleParts].map((part) => part.storageLocation).filter((location): location is string => Boolean(location)))]} manufacturers={[...garageParts, ...vehicleParts].map((part) => part.manufacturer).filter((manufacturer): manufacturer is string => Boolean(manufacturer))} suppliers={[...garageParts, ...vehicleParts].map((part) => part.supplierName).filter((supplier): supplier is string => Boolean(supplier))} onClose={() => setPartDialogOpen(false)} onSave={savePart} onDelete={deletePart} />
      <DocumentDialog open={documentDialogOpen} document={editingDocument} vehicles={vehicles} activeVehicleId={vehicleId} onClose={() => setDocumentDialogOpen(false)} onUpload={uploadDocument} onSave={saveDocument} onDelete={deleteDocument} />
      <VehicleDialog open={vehicleDialogOpen} vehicles={vehicles} onClose={() => setVehicleDialogOpen(false)} onSubmit={addVehicle} />
      {vehicleToDelete && <VehicleDeleteDialog key={vehicleToDelete.id} vehicle={vehicleToDelete} onClose={() => setVehicleToDelete(null)} onDelete={deleteVehicle} />}
      <InsuranceDialog open={insuranceDialogOpen} policy={editingInsurance} vehicles={vehicles} providers={insurancePolicies.map((policy) => policy.provider)} onClose={() => setInsuranceDialogOpen(false)} onSave={saveInsurance} onDelete={deleteInsurance} />
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}

function ActiveSection({
  section,
  dashboard,
  parts,
  partsLoading,
  maintenance,
  onLogMaintenance,
  onLogScheduledService,
  onRemoveScheduledService,
  onEditMaintenance,
  onAddPart,
  onEditPart,
  onDeleteSelected,
  vehicles,
  activeVehicleId,
  onSelectVehicle,
  onDeleteVehicle,
  density,
  onDensityChange,
  documents, insurancePolicies, mileage, servicePlans, reminders, specs, projects, alerts, onAddVehicle, onAddMileage, onEditMileage, onAddPlan, onEditPlan, onConvertFollowUp, onEditVehicle, onAddSpec, onEditSpec, onCloneSpec, onAssignSpec, onAddProject, onEditProject, onToggleProjectTask, onAddDocument, onEditDocument, onAddReminder, onEditReminder, onChangePhoto, onRemovePhoto, onReminderStatus, onMaintenanceVoided, onAddInsurance, onEditInsurance, onAttachInsuranceDocument, onDeleteDocument, onImportBackup, authRequired,
}: {
  section: Section;
  dashboard: DashboardData;
  parts: Part[];
  partsLoading: boolean;
  maintenance: MaintenanceRecord[];
  onLogMaintenance: () => void;
  onLogScheduledService: (service: MaintenanceRecord) => void;
  onRemoveScheduledService: (service: MaintenanceRecord) => Promise<void>;
  onEditMaintenance: (record: MaintenanceRecord) => void;
  onAddPart: () => void;
  onEditPart: (part: Part) => void;
  onDeleteSelected: (parts: Part[]) => Promise<void>;
  vehicles: Vehicle[];
  activeVehicleId: number | null;
  onSelectVehicle: (vehicleId: number) => void;
  onDeleteVehicle: (vehicle: Vehicle) => void;
  density: "comfortable" | "compact";
  onDensityChange: (density: "comfortable" | "compact") => void;
  documents: DocumentRecord[];
  insurancePolicies: InsurancePolicy[];
  mileage: MileageEntry[];
  servicePlans: ServicePlan[];
  reminders: Reminder[];
  specs: ReferenceSpec[];
  projects: Project[];
  alerts: AlertRecord[];
  onAddVehicle: () => void;
  onAddMileage: () => void;
  onEditMileage: (entry: MileageEntry) => void;
  onAddPlan: () => void;
  onEditPlan: (plan: ServicePlan) => void;
  onConvertFollowUp: (record: MaintenanceRecord) => void;
  onEditVehicle: () => void;
  onAddSpec: () => void;
  onEditSpec: (spec: ReferenceSpec) => void;
  onCloneSpec: (spec: ReferenceSpec, vehicleId: number) => Promise<void>;
  onAssignSpec: (spec: ReferenceSpec, vehicleId: number) => Promise<void>;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
  onToggleProjectTask: (taskId: number, completed: boolean) => Promise<void>;
  onAddDocument: () => void;
  onEditDocument: (document: DocumentRecord) => void;
  onAddReminder: () => void;
  onEditReminder: (reminder: Reminder) => void;
  onChangePhoto: (vehicleId: number, file: File) => Promise<void>;
  onRemovePhoto: (vehicleId: number) => Promise<void>;
  onReminderStatus: (id: number, status: Reminder["status"]) => Promise<void>;
  onMaintenanceVoided: (record: MaintenanceRecord, voided: boolean) => Promise<void>;
  onAddInsurance: () => void;
  onEditInsurance: (policy: InsurancePolicy) => void;
  onAttachInsuranceDocument: (policy: InsurancePolicy, file: File) => Promise<void>;
  onDeleteDocument: (document: DocumentRecord) => Promise<void>;
  onImportBackup: (file: File) => Promise<import("./api").RestoreResult>;
  authRequired: boolean;
}) {
  if (section === "maintenance") return <MaintenanceView records={maintenance} documents={documents} plans={servicePlans} reminders={reminders} onAdd={onLogMaintenance} onEdit={onEditMaintenance} onAddPlan={onAddPlan} onEditPlan={onEditPlan} onConvertFollowUp={onConvertFollowUp} onAddReminder={onAddReminder} onEditReminder={onEditReminder} onReminderStatus={onReminderStatus} onMaintenanceVoided={onMaintenanceVoided} />;
  if (section === "parts") return <PartsView parts={parts} vehicles={vehicles} loading={partsLoading} onAdd={onAddPart} onEdit={onEditPart} onDeleteSelected={onDeleteSelected} />;
  if (section === "specs") return <SpecsView specs={specs} vehicles={vehicles} activeVehicleId={activeVehicleId} onAdd={onAddSpec} onEdit={onEditSpec} onClone={onCloneSpec} onAssign={onAssignSpec} onAddVehicle={onAddVehicle} />;
  if (section === "projects") return <ProjectsView projects={projects} onAdd={onAddProject} onEdit={onEditProject} onToggleTask={onToggleProjectTask} />;
  if (section === "documents") return <DocumentsView documents={documents} vehicles={vehicles} onAdd={onAddDocument} onEdit={onEditDocument} />;
  if (section === "insurance") return <InsuranceView policies={insurancePolicies} documents={documents} onAdd={onAddInsurance} onEdit={onEditInsurance} onAttach={onAttachInsuranceDocument} onDeleteDocument={onDeleteDocument} />;
  if (section === "vehicles") return <VehiclesView vehicles={vehicles} policies={insurancePolicies} activeVehicleId={activeVehicleId} mileage={mileage} alerts={alerts} onSelect={onSelectVehicle} onAdd={onAddVehicle} onEdit={onEditVehicle} onDelete={onDeleteVehicle} onAddMileage={onAddMileage} onEditMileage={onEditMileage} onChangePhoto={onChangePhoto} onRemovePhoto={onRemovePhoto} />;
  if (section === "settings") return <SettingsView density={density} onDensityChange={onDensityChange} onImportBackup={onImportBackup} authRequired={authRequired} onLogout={async () => { await api.logout(); window.location.reload(); }} />;

  const openParts = (stock?: "low") => {
    const url = new URL(window.location.href);
    url.pathname = "/parts";
    if (stock) url.searchParams.set("stock", stock); else url.searchParams.delete("stock");
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const openMaintenanceRecord = (record: MaintenanceRecord) => {
    const url = new URL(window.location.href);
    url.pathname = "/maintenance";
    url.searchParams.set("record", String(record.id));
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <div className="dashboard-stack">
      <VehicleSummary data={dashboard} onOpenVehicle={() => onSelectVehicle(dashboard.vehicle.id)} onOpenMaintenance={openMaintenanceRecord} onLogService={onLogScheduledService} onRemoveService={onRemoveScheduledService} />
      <StatusStrip stats={dashboard.partStats} onOpenParts={() => openParts()} />
      <SecondaryPanels parts={parts} onOpenLowStock={() => openParts("low")} />
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState(""); const [status, setStatus] = useState<"idle" | "loading" | "error">("idle"); const [message, setMessage] = useState("");
  return <main className="login-screen"><form className="panel login-card" onSubmit={async (event) => { event.preventDefault(); setStatus("loading"); setMessage(""); try { await onLogin(password); } catch (cause) { setStatus("error"); setMessage(cause instanceof Error ? cause.message : "Sign-in failed."); } }}><span className="login-card__mark">SumpLog</span><h1>Open your garage</h1><p>Enter the owner password configured for this SumpLog server.</p><label htmlFor="owner-password">Password</label><input id="owner-password" autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><div className="dialog__status" aria-live="polite">{message}</div><button className="button button--primary" disabled={status === "loading" || !password}>{status === "loading" ? <><LoaderCircle className="spin" size={17} />Opening…</> : "Open garage"}</button></form></main>;
}
