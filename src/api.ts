export type Vehicle = {
  id: number;
  vin: string | null;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  nickname: string | null;
  mileage: number;
  color: string | null;
  bodyStyle: string | null;
  fuelType: string | null;
  drivetrain: string | null;
  engine: string | null;
  transmission: string | null;
  licensePlate: string | null;
  registrationState: string | null;
  registrationNumber: string | null;
  purchaseDate: string | null;
  purchasePriceCents: number | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceAgentName: string | null;
  insuranceAgentPhone: string | null;
  insuranceEffectiveAt: string | null;
  insuranceExpiresAt: string | null;
  insurancePremiumCents: number | null;
  insuranceNotes: string | null;
  registrationExpiresAt: string | null;
  imageUrl: string | null;
  photoRotation?: number;
  photoZoom?: number;
  photoPositionX?: number;
  photoPositionY?: number;
  annualMileageEstimate: number | null;
  notes: string | null;
};

export type MaintenanceRecord = {
  id: number;
  vehicleId: number;
  title: string;
  category: string;
  serviceDate: string;
  mileage: number;
  costCents: number;
  laborHours: number;
  difficulty: number;
  shopName: string | null;
  notes: string | null;
  nextDueDate: string | null;
  nextDueMileage: number | null;
  voidedAt: string | null;
  parts?: Array<{ partId: number; quantity: number; unitCostCents: number; usageMode: "Whole" | "Partial"; amountUsed: number | null; amountUnit: string | null; name: string; partNumber: string; manufacturer: string | null; supplierName: string | null }>;
  partsCostCents?: number;
};

export type MaintenanceAudit = { id: number; maintenanceId: number; operation: "Created" | "Updated" | "Voided" | "Restored"; summary: string | null; changedAt: string; beforeJson: string | null; afterJson: string };
export type DocumentMaintenanceLink = { id: number; vehicleId: number | null; title: string; category: string; serviceDate: string };
export type DocumentRecord = { notes?: string | null; id: number; trackingId?: string | null; originalName?: string | null; vehicleId: number | null; maintenanceId: number | null; maintenanceIds?: number[]; maintenanceRecords?: DocumentMaintenanceLink[]; projectId?: number | null; insurancePolicyId?: number | null; kind: string; name: string; mimeType: string | null; sizeBytes: number | null; createdAt: string; vehicleName: string | null; maintenanceTitle: string | null; maintenanceCategory: string | null; serviceDate: string | null; insuranceProvider?: string | null; insurancePolicyNumber?: string | null };
export type InsurancePolicy = { id: number; provider: string; policyNumber: string | null; agentName: string | null; agentPhone: string | null; effectiveAt: string | null; expiresAt: string | null; premiumCents: number | null; notes: string | null; vehicleIds: number[]; vehicles: Array<{ id: number; year: number; make: string; model: string; nickname: string | null }>; documentCount: number };
export type InsuranceInput = { provider: string; policyNumber?: string; agentName?: string; agentPhone?: string; effectiveAt?: string; expiresAt?: string; premium?: number | null; notes?: string; vehicleIds: number[] };
export type MileageEntry = { id: number; vehicleId: number; recordedDate: string; mileage: number; annualMileageEstimate: number | null; notes: string | null };
export type ServicePlanItem = { id: number; servicePlanId: number; title: string; notes: string | null; position: number };
export type ServicePlan = { id: number; vehicleId: number; vehicleIds: number[]; title: string; category: string; intervalMileage: number | null; intervalMonths: number | null; nextDueMileage: number | null; nextDueDate: string | null; notes: string | null; active: boolean; items: ServicePlanItem[] };
export type Reminder = { id: number; vehicleId: number; servicePlanId: number | null; maintenanceId: number | null; title: string; dueDate: string | null; dueMileage: number | null; status: "Active" | "Completed" | "Dismissed"; notes: string | null };

export type VehicleInput = {
  vin?: string; year: number; make: string; model: string; trim?: string; nickname?: string;
  mileage: number; mileageDate: string; annualMileageEstimate?: number | null;
  color?: string; bodyStyle?: string; fuelType?: string; drivetrain?: string; engine?: string; transmission?: string;
  licensePlate?: string; registrationState?: string; registrationNumber?: string; purchaseDate?: string; purchasePrice?: number | null;
  insuranceProvider?: string; insurancePolicyNumber?: string; insuranceAgentName?: string; insuranceAgentPhone?: string;
  insuranceEffectiveAt?: string; insuranceExpiresAt?: string; insurancePremium?: number | null; insuranceNotes?: string;
  registrationExpiresAt?: string; notes?: string;
};
export type VehicleUpdateInput = VehicleInput;
export type VehicleDeletionResult = { ok: true; deleted: { maintenanceRecords: number; mileageEntries: number; specifications: number; projects: number; documents: number; servicePlans: number; reminders: number; partFitments: number } };
export type VinDecode = { vin: string; year: number | null; make: string | null; model: string | null; trim: string | null; engine: string | null; transmission: string | null; bodyClass: string | null; fuelType: string | null; manufacturer: string | null; errorText: string | null };

export type MileageInput = { recordedDate: string; mileage: number; annualMileageEstimate?: number | null; notes?: string };
export type ServicePlanInput = { sourceMaintenanceId?: number; title: string; category: string; intervalMileage: number | null; intervalMonths: number | null; nextDueMileage: number | null; nextDueDate: string | null; notes?: string; items: string[]; createReminder: boolean; vehicleIds: number[] };

export type Part = {
  itemType?: "Part" | "Consumable";
  category?: string | null;
  specifications?: string | null;
  approvals?: string | null;
  id: number;
  createdAt: string;
  updatedAt: string;
  partNumber: string;
  name: string;
  manufacturer: string | null;
  quantity: number;
  minimumQuantity: number;
  storageLocation: string | null;
  purchasePriceCents: number;
  supplierName: string | null;
  supplierUrl: string | null;
  volumePerUnit: number | null;
  volumeUnit: string | null;
  notes: string | null;
  vehicleId: number | null;
  fitmentNotes: string | null;
  fitments: Array<{ vehicleId: number; notes: string | null }>;
};

export type PartInput = {
  itemType?: "Part" | "Consumable";
  category?: string;
  specifications?: string;
  approvals?: string;
  partNumber: string;
  name: string;
  manufacturer?: string;
  supplierName?: string;
  supplierUrl?: string;
  purchasePrice: number;
  quantity: number;
  volumePerUnit?: number | null;
  volumeUnit?: string;
  minimumQuantity: number;
  storageLocation?: string;
  notes?: string;
  vehicleId: number | null;
  previousVehicleId?: number | null;
  fitmentNotes?: string;
  fitments?: Array<{ vehicleId: number; notes?: string }>;
};

export type ReferenceSpec = {
  id: number;
  vehicleId: number;
  groupName: string;
  label: string;
  value: string;
  source: string | null;
  notes: string | null;
};
export type SpecInput = { groupName: string; label: string; value: string; source?: string; notes?: string };

export type ProjectTask = { id: number; projectId: number; title: string; completed: boolean; estimatedCostCents: number; position: number };

export type Project = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  estimatedBudgetCents: number;
  actualCostCents: number;
  targetDate: string | null;
  vehicleId: number | null;
  tasks: ProjectTask[];
};
export type ProjectInput = { title: string; description?: string; status: "Backlog" | "Planned" | "In Progress" | "Waiting" | "Done"; estimatedBudget: number; actualCost: number; targetDate?: string; tasks: Array<{ id?: number; title: string; completed: boolean; estimatedCost: number }> };
export type ReminderInput = { title: string; dueDate: string | null; dueMileage: number | null; notes?: string; status: Reminder["status"]; servicePlanId?: number | null };
export type AlertRecord = { id: string; vehicleId: number; kind: string; title: string; detail: string; severity: "overdue" | "due" | "info" };

export type DashboardData = {
  vehicle: Vehicle;
  nextService: MaintenanceRecord | null;
  nextServices: MaintenanceRecord[];
  recentMaintenance: MaintenanceRecord[];
  partStats: { totalParts: number; inventoryValueCents: number; lowStock: number };
  activeProjects: Project[];
  specs: ReferenceSpec[];
};

export type MaintenanceInput = {
  dueSourceId?: number;
  submissionKey?: string;
  title: string;
  category: string;
  serviceDate: string;
  mileage: number;
  cost: number;
  laborHours: number;
  difficulty: number;
  shopName?: string;
  notes?: string;
  nextDueDate?: string;
  nextDueMileage?: number | "";
  parts?: Array<{ partId: number; quantity: number; usageMode?: "Whole" | "Partial"; amountUsed?: number | null; amountUnit?: string | null }>;
};
export type MaintenanceAttachment = { rotation?: number; file: File; kind: string; name: string };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/auth/login") window.dispatchEvent(new Event("sumplog:unauthorized"));
    throw new Error(body?.error ?? `Request failed with status ${response.status}.`);
  }
  return body as T;
}

export type BackupPreview = { counts: Record<string, number>; warnings: string[] };
export type RestoreResult = { ok: true; vehicles: number; warnings: string[]; backupUrl: string };

export const api = {
  authStatus: () => request<{ required: boolean; authenticated: boolean }>("/api/auth/status"),
  login: (password: string) => request<{ ok: true }>("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }),
  changePassword: (currentPassword: string, newPassword: string) => request<{ ok: true }>("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  vehicles: () => request<Vehicle[]>("/api/vehicles"),
  dashboard: (vehicleId: number) => request<DashboardData>(`/api/vehicles/${vehicleId}/dashboard`),
  parts: (vehicleId?: number | null, query = "", signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (vehicleId != null) params.set("vehicleId", String(vehicleId));
    if (query) params.set("q", query);
    return request<Part[]>(`/api/parts?${params}`, { signal });
  },
  maintenance: (vehicleId: number) =>
    request<MaintenanceRecord[]>(`/api/vehicles/${vehicleId}/maintenance`),
  addMaintenance: (vehicleId: number, input: MaintenanceInput) =>
    request<MaintenanceRecord>(`/api/vehicles/${vehicleId}/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  updateMaintenance: (maintenanceId: number, input: MaintenanceInput) =>
    request<MaintenanceRecord>(`/api/maintenance/${maintenanceId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  maintenanceAudit: (maintenanceId: number) => request<MaintenanceAudit[]>(`/api/maintenance/${maintenanceId}/audit`),
  setMaintenanceVoided: (maintenanceId: number, voided: boolean) => request<MaintenanceRecord>(`/api/maintenance/${maintenanceId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voided }) }),
  clearMaintenanceDue: (maintenanceId: number) => request<MaintenanceRecord>(`/api/maintenance/${maintenanceId}/due`, { method: "PATCH" }),
  completeServicePlan: (planId: number, input: { serviceDate: string; mileage: number; nextDueDate?: string; nextDueMileage?: number }) => request<ServicePlan>(`/api/service-plans/${planId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  saveMaintenanceBundle: (vehicleId: number, maintenanceId: number | null, input: MaintenanceInput, attachments: MaintenanceAttachment[]) => {
    const body = new FormData(); body.append("record", JSON.stringify(input)); body.append("attachments", JSON.stringify(attachments.map(({ kind, name, rotation }) => ({ kind, name, rotation })))); attachments.forEach(({ file }) => body.append("files", file));
    return request<MaintenanceRecord>(maintenanceId ? `/api/maintenance/${maintenanceId}/bundle` : `/api/vehicles/${vehicleId}/maintenance-bundle`, { method: maintenanceId ? "PUT" : "POST", body });
  },
  addVehicle: (input: VehicleInput) => request<Vehicle>("/api/vehicles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  updateVehicle: (vehicleId: number, input: VehicleUpdateInput) => request<Vehicle>(`/api/vehicles/${vehicleId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  deleteVehicle: (vehicleId: number) => request<VehicleDeletionResult>(`/api/vehicles/${vehicleId}`, { method: "DELETE" }),
  decodeVin: (vin: string) => request<VinDecode>(`/api/vin/${encodeURIComponent(vin)}`),
  uploadVehicleImage: (vehicleId: number, file: File) => {
    const body = new FormData(); body.append("file", file);
    return request<{ imageUrl: string }>(`/api/vehicles/${vehicleId}/image`, { method: "POST", body });
  },
  removeVehicleImage: (vehicleId: number) => request<{ ok: true }>(`/api/vehicles/${vehicleId}/image`, { method: "DELETE" }),
  mileage: (vehicleId: number) => request<MileageEntry[]>(`/api/vehicles/${vehicleId}/mileage`),
  addMileage: (vehicleId: number, input: MileageInput) => request<MileageEntry>(`/api/vehicles/${vehicleId}/mileage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  updateMileage: (id: number, input: MileageInput) => request<MileageEntry>(`/api/mileage/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  documents: (filters: { vehicleId?: number; kind?: string; category?: string; from?: string; to?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)]));
    return request<DocumentRecord[]>(`/api/documents?${query}`);
  },
  insurance: () => request<InsurancePolicy[]>("/api/insurance"),
  addInsurance: (input: InsuranceInput) => request<InsurancePolicy>("/api/insurance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  updateInsurance: (id: number, input: InsuranceInput) => request<InsurancePolicy>(`/api/insurance/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  deleteInsurance: (id: number) => request<{ ok: true; deletedDocuments: number }>(`/api/insurance/${id}`, { method: "DELETE" }),
  uploadInsuranceDocument: (insurancePolicyId: number, kind: string, file: File) => { const body = new FormData(); body.append("insurancePolicyId", String(insurancePolicyId)); body.append("kind", kind); body.append("file", file); return request<DocumentRecord>("/api/documents", { method: "POST", body }); },
  uploadDocument: (input: { vehicleId: number; maintenanceId?: number; maintenanceIds?: number[]; kind: string; name?: string; notes?: string; file: File }) => {
    const body = new FormData(); body.append("vehicleId", String(input.vehicleId)); if (input.maintenanceId) body.append("maintenanceId", String(input.maintenanceId)); if (input.maintenanceIds) body.append("maintenanceIds", JSON.stringify(input.maintenanceIds)); body.append("kind", input.kind); if (input.name) body.append("name", input.name); if (input.notes) body.append("notes", input.notes); body.append("file", input.file);
    return request<DocumentRecord>("/api/documents", { method: "POST", body });
  },
  updateDocument: (id: number, input: { notes?: string; name: string; kind: string; vehicleId: number | null; maintenanceId?: number | null; maintenanceIds?: number[]; projectId?: number | null }) => request<DocumentRecord>(`/api/documents/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  deleteDocument: (id: number) => request<{ ok: true }>(`/api/documents/${id}`, { method: "DELETE" }),
  servicePlans: (vehicleId: number) => request<ServicePlan[]>(`/api/vehicles/${vehicleId}/service-plans`),
  addServicePlan: (vehicleId: number, input: ServicePlanInput) => request<ServicePlan>(`/api/vehicles/${vehicleId}/service-plans`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  updateServicePlan: (id: number, input: ServicePlanInput & { active: boolean }) => request<ServicePlan>(`/api/service-plans/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  deleteServicePlan: (id: number) => request<{ ok: true }>(`/api/service-plans/${id}`, { method: "DELETE" }),
  reminders: (vehicleId: number) => request<Reminder[]>(`/api/vehicles/${vehicleId}/reminders`),
  updateReminder: (reminderId: number, status: Reminder["status"]) => request<Reminder>(`/api/reminders/${reminderId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
  addReminder: (vehicleId: number, input: ReminderInput) => request<Reminder>(`/api/vehicles/${vehicleId}/reminders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  saveReminder: (id: number, input: ReminderInput) => request<Reminder>(`/api/reminders/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  deleteReminder: (id: number) => request<{ ok: true }>(`/api/reminders/${id}`, { method: "DELETE" }),
  specs: (vehicleId: number) => request<ReferenceSpec[]>(`/api/vehicles/${vehicleId}/specs`),
  addSpec: (vehicleId: number, input: SpecInput) => request<ReferenceSpec>(`/api/vehicles/${vehicleId}/specs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  updateSpec: (id: number, input: SpecInput) => request<ReferenceSpec>(`/api/specs/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  deleteSpec: (id: number) => request<{ ok: true }>(`/api/specs/${id}`, { method: "DELETE" }),
  cloneSpec: (id: number, vehicleId: number) => request<ReferenceSpec>(`/api/specs/${id}/clone`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vehicleId }) }),
  assignSpec: (id: number, vehicleId: number) => request<ReferenceSpec>(`/api/specs/${id}/vehicle`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vehicleId }) }),
  projects: (vehicleId: number) => request<Project[]>(`/api/projects?vehicleId=${vehicleId}`),
  addProject: (vehicleId: number, input: ProjectInput) => request<Project>(`/api/vehicles/${vehicleId}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  updateProject: (id: number, input: ProjectInput) => request<Project>(`/api/projects/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  toggleProjectTask: (id: number, completed: boolean) => request<ProjectTask>(`/api/project-tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed }) }),
  deleteProject: (id: number) => request<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),
  alerts: (vehicleId?: number) => request<AlertRecord[]>(`/api/alerts${vehicleId ? `?vehicleId=${vehicleId}` : ""}`),
  addPart: (input: PartInput) =>
    request<Part>("/api/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  updatePart: (partId: number, input: PartInput) =>
    request<Part>(`/api/parts/${partId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  deletePart: (partId: number) =>
    request<{ ok: true }>(`/api/parts/${partId}`, { method: "DELETE" }),
  previewBackup: (file: File) => { const body = new FormData(); body.append("file", file); return request<BackupPreview>("/api/import/preview", { method: "POST", body }); },
  importBackup: (file: File) => { const body = new FormData(); body.append("file", file); body.append("confirmation", "REPLACE"); return request<RestoreResult>("/api/import/json", { method: "POST", body }); },
};
