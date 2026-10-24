import { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkBackendHealth,
  getPatientRecords,
  loginPatient,
  registerPatient,
  registerDoctor,
  uploadPatientRecord,
  verifyRecordIntegrity,
  registerRecordToBlockchain,
  getProvidersList,
  grantProviderAccess,
  revokeProviderAccess,
} from "./api/api";
import DoctorDashboard from "./components/DoctorDashboard";

const initialTransactions = [
  {
    id: "TX-1001",
    action: "Record Registered",
    recordId: "REC-1001",
    date: "23 Oct 2026, 09:15 AM",
    status: "Confirmed",
    hash: "0x7a91...c42e",
  },
  {
    id: "TX-1002",
    action: "Access Granted",
    recordId: "REC-1002",
    date: "23 Oct 2026, 10:30 AM",
    status: "Confirmed",
    hash: "0x3b82...d910",
  },
  {
    id: "TX-1003",
    action: "Integrity Check",
    recordId: "REC-1003",
    date: "23 Oct 2026, 11:05 AM",
    status: "Pending",
    hash: "0x5f20...a713",
  },
];

const navigation = [
  { label: "Dashboard", icon: "▦" },
  { label: "My Health Records", icon: "▤" },
  { label: "Access Permissions", icon: "♧" },
  { label: "Find a Doctor", icon: "🩺" },
  { label: "Blockchain Audit", icon: "⬡" },
];

function RecordsTable({
  items,
  loading,
  error,
  onRetry,
  hasFilters,
  verifyingMap = {},
  verificationResults = {},
  verificationErrors = {},
  onVerify,
  registeringMap = {},
  onRegisterBlockchain,
}) {
  if (loading) {
    return (
      <div className="p-10 text-center">
        <p className="font-semibold text-slate-700">Loading records...</p>
        <p className="mt-2 text-sm text-slate-500">
          Fetching verified documents from the backend.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="font-semibold text-red-600">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="font-semibold text-slate-700">No records found</p>
        <p className="mt-2 text-sm text-slate-500">
          {hasFilters
            ? "Try a different search term or category."
            : "Upload your first health record using '+ Upload Record'."}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-5 py-4 font-semibold">Record</th>
            <th className="px-5 py-4 font-semibold">Category</th>
            <th className="px-5 py-4 font-semibold">Date</th>
            <th className="px-5 py-4 font-semibold">Blockchain Status</th>
            <th className="px-5 py-4 font-semibold">Integrity Verification</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((record) => {
            const recId = record._id || record.id;
            const isVerifying = Boolean(verifyingMap[recId]);
            const result = verificationResults[recId];
            const verError = verificationErrors[recId];

            const formattedDate = record.createdAt
              ? new Date(record.createdAt).toLocaleDateString("en-US", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : record.date || "N/A";

            const rawStatus = (
              record.blockchainStatus ||
              record.status ||
              "pending"
            ).toLowerCase();
            const displayStatus =
              rawStatus === "verified"
                ? "Verified"
                : rawStatus === "failed"
                ? "Failed"
                : "Pending";

            return (
              <tr key={recId} className="hover:bg-slate-50">
                <td className="px-5 py-4 align-top">
                  <p className="font-semibold text-slate-800">{record.name}</p>
                  <p className="mt-1 font-mono text-xs text-slate-400">
                    {record.originalName ? `${record.originalName} · ` : ""}ID:{" "}
                    {typeof recId === "string" ? recId.slice(-8) : recId}
                  </p>
                </td>
                <td className="px-5 py-4 align-top text-slate-600">{record.type}</td>
                <td className="px-5 py-4 align-top text-slate-600">{formattedDate}</td>
                <td className="px-5 py-4 align-top">
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                      displayStatus === "Verified"
                        ? "bg-emerald-50 text-emerald-700"
                        : displayStatus === "Failed"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {displayStatus}
                  </span>
                </td>
                <td className="px-5 py-4 align-top">
                  <div className="flex flex-col items-start gap-2">
                    <button
                      type="button"
                      onClick={() => onVerify && onVerify(recId)}
                      disabled={isVerifying}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
                        isVerifying
                          ? "cursor-not-allowed bg-slate-100 text-slate-400 border border-slate-200"
                          : "bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 active:bg-blue-200"
                      }`}
                      title="Verify file integrity and on-chain hash registration"
                    >
                      {isVerifying ? (
                        <>
                          <svg
                            className="h-3.5 w-3.5 animate-spin text-blue-600"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8v8H4z"
                            />
                          </svg>
                          <span>Verifying...</span>
                        </>
                      ) : (
                        <>
                          <span>🛡️</span>
                          <span>Verify Integrity</span>
                        </>
                      )}
                    </button>

                    {/* Verification Result Display */}
                    {result && (
                      <div className="w-full max-w-xs rounded-lg border p-2.5 text-xs transition">
                        {result.integrityVerified ? (
                          <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-900">
                            <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                              <span className="text-sm">✓</span> Verified Intact
                            </div>
                            <p className="mt-1 text-[11px] leading-snug text-emerald-700">
                              File matches database and is confirmed on-chain.
                            </p>
                          </div>
                        ) : (
                          <div className="rounded border border-rose-200 bg-rose-50 p-2 text-rose-900">
                            <div className="flex items-center gap-1.5 font-bold text-rose-800">
                              <span className="text-sm">⚠</span> Verification Failed
                            </div>
                            <div className="mt-1.5 space-y-1 text-[11px]">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={
                                    result.fileMatchesDatabase
                                      ? "font-bold text-emerald-600"
                                      : "font-bold text-rose-600"
                                  }
                                >
                                  {result.fileMatchesDatabase ? "✓" : "✗"}
                                </span>
                                <span
                                  className={
                                    result.fileMatchesDatabase
                                      ? "text-slate-600"
                                      : "font-medium text-rose-700"
                                  }
                                >
                                  {result.fileMatchesDatabase
                                    ? "File matches stored hash"
                                    : "File content altered or missing"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={
                                    result.hashRegisteredOnBlockchain
                                      ? "font-bold text-emerald-600"
                                      : "font-bold text-rose-600"
                                  }
                                >
                                  {result.hashRegisteredOnBlockchain ? "✓" : "✗"}
                                </span>
                                <span
                                  className={
                                    result.hashRegisteredOnBlockchain
                                      ? "text-slate-600"
                                      : "font-medium text-rose-700"
                                  }
                                >
                                  {result.hashRegisteredOnBlockchain
                                    ? "Hash registered on blockchain"
                                    : "Hash missing from blockchain"}
                                </span>
                              </div>
                            </div>
                            {result.message && (
                              <p className="mt-1.5 text-[10px] italic text-rose-600">
                                {result.message}
                              </p>
                            )}

                            {/* Re-register on Blockchain button if file matches DB but hash missing on-chain */}
                            {result.fileMatchesDatabase && !result.hashRegisteredOnBlockchain && (
                              <div className="mt-2 pt-2 border-t border-rose-200">
                                <button
                                  type="button"
                                  onClick={() => onRegisterBlockchain && onRegisterBlockchain(recId)}
                                  disabled={Boolean(registeringMap[recId])}
                                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition"
                                >
                                  {registeringMap[recId] ? (
                                    <>
                                      <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                                      <span>Registering on Chain...</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>⬡</span>
                                      <span>Register on Blockchain</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Verification Error Display */}
                    {verError && (
                      <div className="w-full max-w-xs rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                        <span className="font-semibold">Error:</span> {verError}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState("");
  const [providerActionMap, setProviderActionMap] = useState({});
  const [accessMessage, setAccessMessage] = useState("");
  const [doctorSearch, setDoctorSearch] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [backendStatus, setBackendStatus] = useState("Checking...");
  const [backendError, setBackendError] = useState("");

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = sessionStorage.getItem("healthchain_user");
      const savedToken = sessionStorage.getItem("healthchain_token");
      return savedUser && savedToken ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });

  const [authPage, setAuthPage] = useState("login");
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    specialty: "",
    organization: "",
    password: "",
    confirmPassword: "",
  });
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Upload modal / form state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    name: "",
    type: "Laboratory",
    file: null,
  });
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");

  // Record integrity verification state
  const [verifyingMap, setVerifyingMap] = useState({});
  const [registeringMap, setRegisteringMap] = useState({});
  const [verificationResults, setVerificationResults] = useState({});
  const [verificationErrors, setVerificationErrors] = useState({});

  const handleVerifyRecord = useCallback(async (recordId) => {
    if (!recordId || verifyingMap[recordId]) return;

    setVerifyingMap((prev) => ({ ...prev, [recordId]: true }));
    setVerificationErrors((prev) => ({ ...prev, [recordId]: "" }));

    try {
      const result = await verifyRecordIntegrity(recordId);
      setVerificationResults((prev) => ({ ...prev, [recordId]: result }));
    } catch (err) {
      let msg = err.message || "Integrity verification failed.";
      if (
        msg.includes("401") ||
        msg.toLowerCase().includes("token") ||
        msg.toLowerCase().includes("log in")
      ) {
        msg = "Session expired or authentication invalid. Please log in again.";
      } else if (msg.includes("404")) {
        msg = "Record not found or access denied.";
      } else if (
        msg.toLowerCase().includes("failed to fetch") ||
        msg.toLowerCase().includes("network")
      ) {
        msg = "Network error: Unable to reach verification service.";
      }
      setVerificationErrors((prev) => ({ ...prev, [recordId]: msg }));
    } finally {
      setVerifyingMap((prev) => ({ ...prev, [recordId]: false }));
    }
  }, [verifyingMap]);

  useEffect(() => {
    checkBackendHealth()
      .then((data) => {
        setBackendStatus(data.status === "ok" ? "Connected" : "Unavailable");
        setBackendError("");
      })
      .catch(() => {
        setBackendStatus("Disconnected");
        setBackendError("Unable to connect to the backend.");
      });
  }, []);

  const loadRecords = useCallback(async () => {
    if (!currentUser) return;
    setRecordsLoading(true);
    setRecordsError("");
    try {
      const data = await getPatientRecords();
      setRecords(data.records || []);
    } catch (err) {
      setRecordsError(err.message || "Failed to load health records.");
    } finally {
      setRecordsLoading(false);
    }
  }, [currentUser]);

  const handleRegisterRecord = useCallback(
    async (recordId) => {
      if (!recordId || registeringMap[recordId]) return;

      setRegisteringMap((prev) => ({ ...prev, [recordId]: true }));
      setVerificationErrors((prev) => ({ ...prev, [recordId]: "" }));

      try {
        await registerRecordToBlockchain(recordId);
        await loadRecords();
        // Automatically re-run integrity check to confirm verified state on-chain
        const refreshedResult = await verifyRecordIntegrity(recordId);
        setVerificationResults((prev) => ({ ...prev, [recordId]: refreshedResult }));
      } catch (err) {
        setVerificationErrors((prev) => ({
          ...prev,
          [recordId]: `Failed to register on blockchain: ${err.message}`,
        }));
      } finally {
        setRegisteringMap((prev) => ({ ...prev, [recordId]: false }));
      }
    },
    [registeringMap, loadRecords]
  );

  const loadProviders = useCallback(async () => {
    if (!currentUser) return;
    setProvidersLoading(true);
    setProvidersError("");
    try {
      const data = await getProvidersList();
      setProviders(data.providers || []);
    } catch (err) {
      setProvidersError(err.message || "Failed to load healthcare providers.");
    } finally {
      setProvidersLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    let ignore = false;
    if (currentUser && currentUser.role === "patient") {
      getPatientRecords()
        .then((data) => {
          if (!ignore) {
            setRecords(data.records || []);
            setRecordsLoading(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            setRecordsError(err.message || "Failed to load health records.");
            setRecordsLoading(false);
          }
        });

      getProvidersList()
        .then((data) => {
          if (!ignore) {
            setProviders(data.providers || []);
            setProvidersLoading(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            setProvidersError(err.message || "Failed to load providers.");
            setProvidersLoading(false);
          }
        });
    }
    return () => {
      ignore = true;
    };
  }, [currentUser]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const recId = (record._id || record.id || "").toString().toLowerCase();
      const recName = (record.name || "").toLowerCase();
      const query = search.toLowerCase();

      const matchesSearch = recName.includes(query) || recId.includes(query);
      const matchesCategory = category === "All" || record.type === category;

      return matchesSearch && matchesCategory;
    });
  }, [records, search, category]);

  const filteredDoctors = useMemo(() => {
    const query = doctorSearch.trim().toLowerCase();
    if (!query) return providers;
    return providers.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(query) ||
        (p.specialty || "").toLowerCase().includes(query) ||
        (p.organization || "").toLowerCase().includes(query)
    );
  }, [providers, doctorSearch]);


  async function handleUploadSubmit(event) {
    event.preventDefault();
    setUploadError("");
    setUploadSuccess("");

    if (!uploadForm.file) {
      setUploadError("Please select a file to upload.");
      return;
    }

    if (!uploadForm.name.trim()) {
      setUploadError("Record name is required.");
      return;
    }

    setUploadLoading(true);

    try {
      const data = await uploadPatientRecord({
        name: uploadForm.name.trim(),
        type: uploadForm.type,
        file: uploadForm.file,
      });

      setUploadSuccess(
        data.message || `Record "${uploadForm.name.trim()}" uploaded successfully.`
      );
      setUploadForm({
        name: "",
        type: "Laboratory",
        file: null,
      });
      setIsUploadOpen(false);
      await loadRecords();
    } catch (error) {
      setUploadError(error.message || "Failed to upload record.");
    } finally {
      setUploadLoading(false);
    }
  }

  const stats = [
    {
      label: "Total Records",
      value: String(records.length),
      note: "Stored health documents",
      icon: "▤",
      color: "bg-blue-50 text-blue-700",
    },
    {
      label: "Verified Records",
      value: String(
        records.filter(
          (r) => (r.blockchainStatus || r.status || "").toLowerCase() === "verified"
        ).length
      ),
      note: "On-chain integrity status",
      icon: "✓",
      color: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Access Granted",
      value: String(providers.filter((p) => p.access).length),
      note: "Authorized providers",
      icon: "♧",
      color: "bg-violet-50 text-violet-700",
    },
    {
      label: "Blockchain Status",
      value: "Active",
      note: "Local test network",
      icon: "⬡",
      color: "bg-amber-50 text-amber-700",
    },
  ];

  async function toggleProviderAccess(providerId) {
    if (!providerId || providerActionMap[providerId]) return;

    const targetProvider = providers.find((p) => p.id === providerId);
    if (!targetProvider) return;

    const isCurrentlyGranted = Boolean(targetProvider.access);
    const action = isCurrentlyGranted ? "revoke" : "grant";

    setProviderActionMap((prev) => ({ ...prev, [providerId]: true }));
    setAccessMessage("");

    try {
      if (isCurrentlyGranted) {
        await revokeProviderAccess(providerId);
        setAccessMessage(`Access revoked on-chain for ${targetProvider.name}.`);
      } else {
        await grantProviderAccess(providerId);
        setAccessMessage(`Access granted on-chain for ${targetProvider.name}.`);
      }

      setProviders((currentProviders) =>
        currentProviders.map((provider) =>
          provider.id === providerId
            ? { ...provider, access: !isCurrentlyGranted }
            : provider
        )
      );
    } catch (err) {
      setAccessMessage(`Failed to ${action} access: ${err.message}`);
    } finally {
      setProviderActionMap((prev) => ({ ...prev, [providerId]: false }));
    }
  }

  const filteredTransactions = initialTransactions.filter((tx) => {
    const query = auditSearch.toLowerCase();
    return (
      tx.id.toLowerCase().includes(query) ||
      tx.action.toLowerCase().includes(query) ||
      tx.recordId.toLowerCase().includes(query)
    );
  });

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError("");
    setAuthMessage("");
    setAuthLoading(true);

    try {
      if (authPage === "register") {
        const data = await registerPatient({
          name: authForm.name,
          email: authForm.email,
          password: authForm.password,
        });
        setAuthMessage(data.message || "Registration successful. Please log in.");
        setAuthPage("login");
        setAuthForm({
          name: "",
          email: "",
          specialty: "",
          organization: "",
          password: "",
          confirmPassword: "",
        });
      } else if (authPage === "register-doctor") {
        if (!authForm.name.trim() || !authForm.email.trim() || !authForm.specialty.trim() || !authForm.organization.trim() || !authForm.password) {
          setAuthError("All doctor fields are required.");
          setAuthLoading(false);
          return;
        }
        if (authForm.password !== authForm.confirmPassword) {
          setAuthError("Password and Confirm Password do not match.");
          setAuthLoading(false);
          return;
        }
        const data = await registerDoctor({
          name: authForm.name.trim(),
          email: authForm.email.trim(),
          specialty: authForm.specialty.trim(),
          organization: authForm.organization.trim(),
          password: authForm.password,
          confirmPassword: authForm.confirmPassword,
        });
        setAuthMessage(data.message || "Doctor registered successfully! You can now log in.");
        setAuthPage("login");
        setAuthForm({
          name: "",
          email: "",
          specialty: "",
          organization: "",
          password: "",
          confirmPassword: "",
        });
      } else {
        const data = await loginPatient({
          email: authForm.email,
          password: authForm.password,
        });

        setCurrentUser(data.user);
        sessionStorage.setItem("healthchain_token", data.token);
        sessionStorage.setItem("healthchain_user", JSON.stringify(data.user));

        setAuthForm({
          name: "",
          email: "",
          specialty: "",
          organization: "",
          password: "",
          confirmPassword: "",
        });
        setAuthMessage("");
      }
    } catch (error) {
      setAuthError(error.message || "Something went wrong.");
    } finally {
      setAuthLoading(false);
    }
  }

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem("healthchain_token");
    sessionStorage.removeItem("healthchain_user");
    setCurrentUser(null);
    setRecords([]);
    setAuthPage("login");
    setAuthForm({ name: "", email: "", password: "" });
    setAuthError("");
    setAuthMessage("");
    setVerifyingMap({});
    setVerificationResults({});
    setVerificationErrors({});
  }, []);

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
          <div className="mb-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-3xl text-white">
              ✚
            </div>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">
              HealthChain
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Secure patient health record management
            </p>
          </div>

          <div className="mb-6 grid grid-cols-3 rounded-xl bg-slate-100 p-1 text-xs sm:text-sm">
            <button
              type="button"
              onClick={() => {
                setAuthPage("login");
                setAuthError("");
                setAuthMessage("");
              }}
              className={`rounded-lg py-2 font-semibold transition ${
                authPage === "login"
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthPage("register");
                setAuthError("");
                setAuthMessage("");
              }}
              className={`rounded-lg py-2 font-semibold transition ${
                authPage === "register"
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Patient
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthPage("register-doctor");
                setAuthError("");
                setAuthMessage("");
              }}
              className={`rounded-lg py-2 font-semibold transition ${
                authPage === "register-doctor"
                  ? "bg-white text-teal-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Doctor
            </button>
          </div>

          {authMessage && (
            <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              {authMessage}
            </p>
          )}

          {authError && (
            <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {authError}
            </p>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authPage === "register" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Full name *
                </label>
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={authForm.name}
                  onChange={(event) =>
                    setAuthForm({ ...authForm, name: event.target.value })
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-blue-500"
                  placeholder="Enter your full name"
                />
              </div>
            )}

            {authPage === "register-doctor" && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Doctor Full Name *
                  </label>
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={authForm.name}
                    onChange={(event) =>
                      setAuthForm({ ...authForm, name: event.target.value })
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-teal-600"
                    placeholder="e.g. Dr. Rajesh Verma"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Specialization *
                    </label>
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      value={authForm.specialty}
                      onChange={(event) =>
                        setAuthForm({ ...authForm, specialty: event.target.value })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-teal-600"
                      placeholder="e.g. Cardiologist"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Hospital or Clinic *
                    </label>
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      value={authForm.organization}
                      onChange={(event) =>
                        setAuthForm({ ...authForm, organization: event.target.value })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-teal-600"
                      placeholder="e.g. City Care Hospital"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Email address *
              </label>
              <input
                required
                type="email"
                autoComplete="email"
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm({ ...authForm, email: event.target.value })
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-blue-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Password *
              </label>
              <input
                required
                type="password"
                minLength={8}
                autoComplete={authPage.startsWith("register") ? "new-password" : "current-password"}
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm({ ...authForm, password: event.target.value })
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-blue-500"
                placeholder="At least 8 characters"
              />
            </div>

            {authPage === "register-doctor" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Confirm Password *
                </label>
                <input
                  required
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={authForm.confirmPassword}
                  onChange={(event) =>
                    setAuthForm({ ...authForm, confirmPassword: event.target.value })
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-teal-600"
                  placeholder="Re-enter password"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className={`w-full rounded-lg px-4 py-3 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                authPage === "register-doctor"
                  ? "bg-teal-700 hover:bg-teal-800"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {authLoading
                ? "Please wait..."
                : authPage === "register-doctor"
                ? "Create Doctor Account"
                : authPage === "register"
                ? "Create Patient Account"
                : "Login"}
            </button>
          </form>

          {authPage === "login" && (
            <p className="mt-4 text-center text-xs text-slate-500">
              Healthcare provider?{" "}
              <button
                type="button"
                onClick={() => {
                  setAuthPage("register-doctor");
                  setAuthError("");
                  setAuthMessage("");
                }}
                className="font-semibold text-teal-700 hover:underline"
              >
                Register as Doctor
              </button>
            </p>
          )}

          <p className="mt-5 text-center text-xs leading-5 text-slate-400">
            Student demonstration only. Use synthetic information, not real
            medical records.
          </p>
        </div>
      </div>
    );
  }

  // Role-based dashboard dispatch
  if (currentUser.role === "doctor" || currentUser.role === "hospital") {
    return (
      <DoctorDashboard
        currentUser={currentUser}
        onLogout={handleLogout}
        backendStatus={backendStatus}
        backendError={backendError}
      />
    );
  }

  // Patient Dashboard
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 md:flex">
      <aside className="flex w-full flex-col border-r border-slate-200 bg-white md:fixed md:inset-y-0 md:w-64">
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-2xl text-white">
            ✚
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">HealthChain</h1>
            <p className="text-xs text-slate-500">Patient Portal</p>
          </div>
        </div>

        <div className="px-4 py-5">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <nav className="space-y-1">
            {navigation.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  setActivePage(item.label);
                  setUploadError("");
                  setUploadSuccess("");
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                  activePage === item.label
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="w-6 text-center text-lg">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto hidden p-4 md:block">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <p className="text-sm font-semibold">
                Backend: {backendStatus}
              </p>
            </div>
            {backendError && (
              <p className="mt-2 text-xs text-red-600">{backendError}</p>
            )}
            <p className="text-xs leading-5 text-slate-500">
              Development environment. Use synthetic data only.
            </p>
          </div>
          <p className="mt-4 text-center text-xs text-slate-400">
            HealthChain · Student Project
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-5 sm:p-8 md:ml-64">
        <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="mb-1 text-sm text-slate-500">
              Patient Portal / {activePage}
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {activePage}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Manage your health information securely in one place.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-start rounded-xl border border-slate-200 bg-white px-4 py-3 sm:self-auto">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
              {currentUser.name?.charAt(0).toUpperCase()}
            </div>

            <div>
              <p className="text-sm font-semibold">{currentUser.name}</p>
              <p className="text-xs capitalize text-slate-500">
                {currentUser.role}
              </p>
            </div>

            <button
              onClick={handleLogout}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              Logout
            </button>
          </div>
        </header>

        {activePage === "Dashboard" && (
          <>
            <section className="mb-7 rounded-2xl bg-gradient-to-r from-blue-700 to-indigo-600 p-6 text-white sm:p-8">
              <p className="text-sm font-medium text-blue-100">
                YOUR HEALTH, YOUR CONTROL
              </p>
              <h3 className="mt-2 text-2xl font-bold sm:text-3xl">
                Welcome to HealthChain
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-blue-100">
                View your health records, manage provider permissions, and
                check record integrity through our blockchain-based system.
              </p>
              <button
                onClick={() => setActivePage("My Health Records")}
                className="mt-5 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                View Health Records →
              </button>
            </section>

            <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-500">{stat.label}</p>
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl font-bold ${stat.color}`}
                    >
                      {stat.icon}
                    </span>
                  </div>
                  <p className="mt-4 text-2xl font-bold text-slate-900">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{stat.note}</p>
                </div>
              ))}
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
                <div>
                  <h3 className="font-bold text-slate-900">
                    Recent Health Records
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Your latest uploaded documents
                  </p>
                </div>
                <button
                  onClick={() => setActivePage("My Health Records")}
                  className="self-start rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                >
                  View all
                </button>
              </div>
              <RecordsTable
                items={records.slice(0, 3)}
                loading={recordsLoading}
                error={recordsError}
                onRetry={loadRecords}
                hasFilters={false}
                verifyingMap={verifyingMap}
                verificationResults={verificationResults}
                verificationErrors={verificationErrors}
                onVerify={handleVerifyRecord}
                registeringMap={registeringMap}
                onRegisterBlockchain={handleRegisterRecord}
              />
              <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
                Health records stored securely via backend with SHA-256 integrity verification.
              </div>
            </section>
          </>
        )}

        {activePage === "My Health Records" && (
          <>
            <section className="mb-6 flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Manage Health Records
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Search, filter, and upload your secure medical documents.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsUploadOpen((prev) => !prev);
                  setUploadError("");
                  setUploadSuccess("");
                }}
                className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition"
              >
                {isUploadOpen ? "✕ Close Upload Form" : "+ Upload Record"}
              </button>
            </section>

            {isUploadOpen && (
              <section className="mb-6 rounded-2xl border border-blue-100 bg-white p-6 shadow-sm">
                <h4 className="text-base font-bold text-slate-900 mb-1">
                  Upload Health Record
                </h4>
                <p className="text-xs text-slate-500 mb-4">
                  Select a medical document (PDF, PNG, or JPEG, up to 5 MB). File signatures and SHA-256 hashes are automatically validated.
                </p>

                {uploadError && (
                  <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                    {uploadError}
                  </div>
                )}

                <form onSubmit={handleUploadSubmit} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Record Name *
                      </label>
                      <input
                        required
                        type="text"
                        placeholder="e.g. Complete Blood Count"
                        value={uploadForm.name}
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, name: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Category / Type *
                      </label>
                      <select
                        value={uploadForm.type}
                        onChange={(e) =>
                          setUploadForm({ ...uploadForm, type: e.target.value })
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                      >
                        <option value="Laboratory">Laboratory</option>
                        <option value="Consultation">Consultation</option>
                        <option value="Radiology">Radiology</option>
                        <option value="Prescription">Prescription</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Document File (PDF, PNG, JPEG max 5MB) *
                    </label>
                    <input
                      required
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setUploadForm({ ...uploadForm, file });
                        setUploadError("");
                      }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={uploadLoading}
                      className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
                    >
                      {uploadLoading ? "Uploading & Hashing..." : "Submit Record"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsUploadOpen(false);
                        setUploadError("");
                      }}
                      className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </section>
            )}

            {uploadSuccess && (
              <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-center justify-between">
                <span>✓ {uploadSuccess}</span>
                <button
                  onClick={() => setUploadSuccess("")}
                  className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold ml-3"
                >
                  ✕
                </button>
              </div>
            )}

            <section className="mb-6 grid gap-4 sm:grid-cols-[1fr_220px]">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by record name or ID..."
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500"
              >
                <option value="All">All categories</option>
                <option value="Laboratory">Laboratory</option>
                <option value="Consultation">Consultation</option>
                <option value="Radiology">Radiology</option>
                <option value="Prescription">Prescription</option>
                <option value="Other">Other</option>
              </select>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 p-5">
                <h3 className="font-bold text-slate-900">All Records</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {filteredRecords.length} found
                </span>
              </div>
              <RecordsTable
                items={filteredRecords}
                loading={recordsLoading}
                error={recordsError}
                onRetry={loadRecords}
                hasFilters={Boolean(search || category !== "All")}
                verifyingMap={verifyingMap}
                verificationResults={verificationResults}
                verificationErrors={verificationErrors}
                onVerify={handleVerifyRecord}
                registeringMap={registeringMap}
                onRegisterBlockchain={handleRegisterRecord}
              />
              <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
                All uploaded files are validated with streaming SHA-256 hashes and stored outside public access.
              </div>
            </section>
          </>
        )}

        {activePage === "Access Permissions" && (
          <section>
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Manage Provider Access
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Authorize or revoke verified healthcare providers on the smart contract.
                  </p>
                </div>
                <button
                  onClick={loadProviders}
                  disabled={providersLoading}
                  className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  {providersLoading ? "Refreshing..." : "↻ Refresh List"}
                </button>
              </div>

              {accessMessage && (
                <div
                  className={`mt-4 rounded-xl border p-3 text-sm ${
                    accessMessage.toLowerCase().includes("failed") || accessMessage.toLowerCase().includes("error")
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  {accessMessage}
                </div>
              )}

              {providersError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <span className="font-semibold">Error:</span> {providersError}
                </div>
              )}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-sm text-emerald-700">Access Granted</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-800">
                    {providers.filter((provider) => provider.access).length}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-100 p-4">
                  <p className="text-sm text-slate-600">Total Providers</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {providers.length}
                  </p>
                </div>
              </div>
            </div>

            {providersLoading && providers.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                Loading healthcare providers...
              </div>
            ) : providers.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                No healthcare providers found.
              </div>
            ) : (
              <div className="space-y-4">
                {providers.map((provider) => {
                  const isProcessing = Boolean(providerActionMap[provider.id]);
                  return (
                    <div
                      key={provider.id}
                      className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-lg font-bold text-blue-700">
                          {provider.name
                            .split(" ")
                            .slice(1)
                            .map((part) => part[0])
                            .join("")
                            .slice(0, 2) || provider.name.slice(0, 2)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-slate-900">
                              {provider.name}
                            </h4>
                            {provider.isWalletVerified ? (
                              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                Verified Wallet
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                Unverified
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-slate-600">
                            {provider.specialty}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {provider.organization}
                            {provider.ethereumAddress && (
                              <span className="ml-2 font-mono text-[11px] text-slate-400">
                                ({provider.ethereumAddress.slice(0, 6)}...{provider.ethereumAddress.slice(-4)})
                              </span>
                            )}
                          </p>
                          <span
                            className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                              provider.access
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {provider.access ? "Access Granted" : "Access Revoked"}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => toggleProviderAccess(provider.id)}
                        disabled={isProcessing || !provider.isWalletVerified}
                        className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          provider.access
                            ? "border border-red-200 text-red-600 hover:bg-red-50"
                            : "bg-blue-600 text-white hover:bg-blue-700"
                        }`}
                      >
                        {isProcessing && (
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        )}
                        {isProcessing
                          ? provider.access
                            ? "Revoking on Blockchain..."
                            : "Granting on Blockchain..."
                          : provider.access
                          ? "Revoke Access"
                          : "Grant Access"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
              <span className="font-semibold">Live Blockchain Protection:</span> Permissions are recorded directly on the smart contract (`HealthRecordContract.sol`) via Ganache. Only healthcare providers with active on-chain access can retrieve and view medical records.
            </div>
          </section>
        )}

        {activePage === "Blockchain Audit" && (
          <section>
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Blockchain Audit Trail
                  </h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Review sample record events and transaction references.
                  </p>
                </div>

                <span className="inline-flex items-center gap-2 self-start rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Demo data
                </span>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl bg-blue-50 p-4">
                  <p className="text-sm text-blue-700">Total Events</p>
                  <p className="mt-2 text-2xl font-bold text-blue-900">
                    {initialTransactions.length}
                  </p>
                </div>

                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-sm text-emerald-700">Confirmed</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-900">
                    {initialTransactions.filter((tx) => tx.status === "Confirmed").length}
                  </p>
                </div>

                <div className="rounded-xl bg-amber-50 p-4">
                  <p className="text-sm text-amber-700">Pending</p>
                  <p className="mt-2 text-2xl font-bold text-amber-900">
                    {initialTransactions.filter((tx) => tx.status === "Pending").length}
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-5">
              <input
                type="search"
                value={auditSearch}
                onChange={(event) => setAuditSearch(event.target.value)}
                placeholder="Search transaction ID, action, or record ID..."
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5">
                <h3 className="font-bold text-slate-900">Transaction History</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {filteredTransactions.length} sample events found
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[750px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Transaction</th>
                      <th className="px-5 py-4 font-semibold">Action</th>
                      <th className="px-5 py-4 font-semibold">Record</th>
                      <th className="px-5 py-4 font-semibold">Timestamp</th>
                      <th className="px-5 py-4 font-semibold">Status</th>
                      <th className="px-5 py-4 font-semibold">Hash Reference</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {filteredTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-semibold text-slate-800">
                          {tx.id}
                        </td>
                        <td className="px-5 py-4 text-slate-600">{tx.action}</td>
                        <td className="px-5 py-4 text-slate-600">{tx.recordId}</td>
                        <td className="px-5 py-4 text-slate-600">{tx.date}</td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              tx.status === "Confirmed"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-500">
                          {tx.hash}
                        </td>
                      </tr>
                    ))}

                    {filteredTransactions.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                          No matching transactions found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 text-xs leading-5 text-slate-500">
                These transaction IDs and hash references are placeholders. Live
                blockchain events and transaction hashes are not connected yet.
              </div>
            </div>
          </section>
        )}

        {activePage === "Find a Doctor" && (
          <section>
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Find a Doctor & Directory
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Browse registered medical specialists and authorize on-chain access to your health documents.
                  </p>
                </div>
                <button
                  onClick={loadProviders}
                  disabled={providersLoading}
                  className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition"
                >
                  {providersLoading ? "Refreshing..." : "↻ Refresh Directory"}
                </button>
              </div>

              <div className="mt-5">
                <input
                  type="text"
                  placeholder="Search by doctor name, specialization (e.g. Cardiologist), or clinic/hospital..."
                  value={doctorSearch}
                  onChange={(e) => setDoctorSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600 transition"
                />
              </div>

              {accessMessage && (
                <div
                  className={`mt-4 rounded-xl border p-3 text-sm ${
                    accessMessage.toLowerCase().includes("failed") || accessMessage.toLowerCase().includes("error")
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  {accessMessage}
                </div>
              )}
            </div>

            {providersLoading && providers.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                Loading doctor directory...
              </div>
            ) : filteredDoctors.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                {doctorSearch ? `No doctors found matching "${doctorSearch}".` : "No registered doctors found in the directory."}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredDoctors.map((doc) => {
                  const isProcessing = Boolean(providerActionMap[doc.id]);
                  return (
                    <div
                      key={doc.id}
                      className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 transition"
                    >
                      <div>
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-lg font-bold text-teal-800">
                            {doc.name
                              .split(" ")
                              .slice(1)
                              .map((p) => p[0])
                              .join("")
                              .slice(0, 2) || doc.name.slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-slate-900 truncate">{doc.name}</h4>
                            <span className="inline-block mt-0.5 rounded-md bg-teal-50 border border-teal-200 px-2 py-0.5 text-xs font-semibold text-teal-800">
                              {doc.specialty || "Medical Doctor"}
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 space-y-1.5 text-xs text-slate-600">
                          <p>
                            <span className="font-medium text-slate-800">Hospital/Clinic:</span>{" "}
                            {doc.organization || "Medical Practice"}
                          </p>
                          <p>
                            <span className="font-medium text-slate-800">Email:</span> {doc.email}
                          </p>
                          <p>
                            <span className="font-medium text-slate-800">Wallet:</span>{" "}
                            {doc.isWalletVerified && doc.ethereumAddress ? (
                              <span className="font-mono text-emerald-700 font-medium">
                                {doc.ethereumAddress.slice(0, 6)}...{doc.ethereumAddress.slice(-4)} (Verified)
                              </span>
                            ) : (
                              <span className="text-amber-600 font-medium">Wallet Pending</span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 border-t border-slate-100 pt-4">
                        <div className="mb-3 flex items-center justify-between">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              doc.access
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {doc.access ? "Access Granted" : "No Access"}
                          </span>
                        </div>

                        {doc.isWalletVerified ? (
                          <button
                            onClick={() => toggleProviderAccess(doc.id)}
                            disabled={isProcessing}
                            className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              doc.access
                                ? "border border-red-200 text-red-600 hover:bg-red-50"
                                : "bg-blue-600 text-white hover:bg-blue-700"
                            }`}
                          >
                            {isProcessing && (
                              <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            )}
                            {isProcessing
                              ? doc.access
                                ? "Revoking..."
                                : "Granting on Blockchain..."
                              : doc.access
                              ? "Revoke Access"
                              : "Grant Access on Blockchain"}
                          </button>
                        ) : (
                          <button
                            disabled
                            title="Doctor has not verified an Ethereum address. On-chain access requires a verified wallet."
                            className="w-full rounded-lg bg-slate-100 px-4 py-2 text-xs font-medium text-slate-400 cursor-not-allowed"
                          >
                            Wallet Verification Pending
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activePage !== "Dashboard" &&
          activePage !== "My Health Records" &&
          activePage !== "Access Permissions" &&
          activePage !== "Find a Doctor" &&
          activePage !== "Blockchain Audit" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-bold text-slate-900">{activePage}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                This section will be implemented in the next development stage.
              </p>
              <button
                onClick={() => setActivePage("Dashboard")}
                className="mt-5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                ← Back to Dashboard
              </button>
            </section>
          )}
      </main>
    </div>
  );
}

export default App;
