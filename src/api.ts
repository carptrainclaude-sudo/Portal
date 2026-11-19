export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Помилка ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
};

// ---- Типи ----
export type Role = 'buyer' | 'dispatcher' | 'customer';
export type User = { email: string; role: Role; fullName: string };
export type Option = { value: string; label: string };
export type Location = { id: number; name: string };
export type Staff = { email: string; fullName: string };
export type Meta = {
  categories: { id: number; name: string }[];
  locations: Location[];
  units: string[];
  buyers: Staff[];
  dispatchers: Staff[];
  months: Option[];
  mailpitUrl: string;
};
export type Product = { id: number; name: string; unit: string; userAdded?: number };

export type RequestLine = {
  id: number; lineOrder: number; productId: number | null; name: string; unit: string;
  isNew: number; wasNew: number; newName: string | null; newUnit: string | null;
  sourceRequestId: number | null; userAdded: number | null;
  removed: number; removedComment: string | null; removedAt: string | null; removedQty: number | null; removedByName: string | null;
};
export type RequestItem = {
  id: number; lineId: number; locationId: number; locationName: string; qty: number; status: string;
  plannedDate: string | null; executorEmail: string | null; executorName: string | null;
};
export type RequestDetail = {
  id: number; type: string; status: string; categoryId: number; category: string;
  customerEmail: string; lastName: string; firstName: string; phone: string; deliveryMonth: string;
  assigneeEmail: string | null; assigneeName: string | null; takenAt: string | null; reworkComment: string | null;
  createdAt: string; updatedAt: string; submittedAt: string;
  lines: RequestLine[];
  items: RequestItem[];
  events: { at: string; actorEmail: string; actorName: string; text: string }[];
};
export type PurchaseRow = {
  id: number; createdAt: string; submittedAt: string; deliveryMonth: string; status: string; type: string;
  reworkComment: string | null; lastName: string; firstName: string; assigneeEmail: string | null; assigneeName?: string | null;
  category: string; productCount: number; newCount: number; removedCount: number;
  itemCount: number; doneCount: number; transitCount: number; unread?: string[];
};

export type TransportRow = {
  id: number; status: string; createdAt: string; customerEmail: string; fullName: string;
  loadAddress: string; unloadAddress: string; loadAt: string; unloadAt: string; sealRequired: number;
  carNumber: string | null; driverName: string | null; completedAt: string | null;
  dispatcherEmail: string | null; dispatcherName: string | null; reworkComment: string | null; unread?: string[];
};
export type CarData = {
  driverName: string; driverPhone: string; carModel: string | null; carNumber: string;
  driverLicense: string | null; loadAt: string; deliveryAt: string;
};
export type TransportDetail = {
  id: number; status: string; customerEmail: string; fullName: string; phone: string; position: string;
  loadAddress: string; loadContactName: string; loadContactPhone: string; loadAt: string;
  cargoDetails: string; sealRequired: boolean;
  unloadAddress: string; unloadContactName: string | null; unloadContactPhone: string | null; unloadCompany: string | null; unloadAt: string;
  dispatcherEmail: string | null; dispatcherName: string | null; takenAt: string | null;
  reworkComment: string | null; cancelComment: string | null; car: CarData | null;
  completedAt: string | null; createdAt: string; updatedAt: string; submittedAt: string;
  events: { at: string; actorEmail: string; actorName: string; statusFrom: string | null; statusTo: string | null; comment: string | null; text: string }[];
};
export type Counters = { inbox?: number; transportNew?: number; unread?: { total: number; purchase: number; transport: number } };
