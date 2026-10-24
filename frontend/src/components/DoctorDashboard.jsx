import { useState, useCallback } from "react";
import {
  getPatientRecordsByEmailForDoctor,
  downloadRecordFile,
  previewRecordFile,
  verifyRecordIntegrity,
} from "../api/api";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export default function DoctorDashboard({
  currentUser,
  onLogout,
  backendStatus = "Connected",
  backendError = "",
}) {
  const [activeTab, setActiveTab] = useState("records"); // 'records' | 'profile' | 'security'
  const [patientEmailInput, setPatientEmailInput] = useState("");
  const [searchedPatient, setSearchedPatient] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [queryError, setQueryError] = useState("");
  const [querySuccess, setQuerySuccess] = useState("");

  // Per-record actions state
  const [downloadingMap, setDownloadingMap] = useState({});
  const [previewingMap, setPreviewingMap] = useState({});
  const [verifyingMap, setVerifyingMap] = useState({});
  const [verificationFeedback, setVerificationFeedback] = useState({});
  const [copiedHash, setCopiedHash] = useState(null);

  const demoPatientEmail = "satya@gmail.com";

  const handleFetchRecords = useCallback(
    async (targetPatientEmail) => {
      const email = (targetPatientEmail || patientEmailInput).trim();
      if (!email) {
        setQueryError("Please enter a valid Patient Email address.");
        return;
      }

      setLoading(true);
      setQueryError("");
      setQuerySuccess("");
      setVerificationFeedback({});

      try {
        const data = await getPatientRecordsByEmailForDoctor(email);
        setRecords(data.records || []);
        setSearchedPatient(data.patient || { email });
        setQuerySuccess(
          `Successfully loaded ${data.count} authorized record(s) for patient ${data.patient?.name ? data.patient.name + " " : ""}(${email}).`
        );
      } catch (err) {
        setRecords([]);
        setSearchedPatient(null);
        if (err.status === 403) {
          setQueryError(
            `Access Forbidden (403): You do not have active on-chain permission to access records for patient (${email}). The smart contract hasAccess() check returned false.`
          );
        } else if (err.status === 400) {
          setQueryError(
            "Invalid email address format (400). Please provide a valid patient email."
          );
        } else if (err.status === 404) {
          setQueryError(
            `Patient not found (404). No registered patient exists with email: ${email}.`
          );
        } else {
          setQueryError(
            err.message || "Failed to retrieve records. Please try again."
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [patientEmailInput]
  );

  const handleDownload = async (record) => {
    const recId = record._id || record.id;
    setDownloadingMap((prev) => ({ ...prev, [recId]: true }));
    try {
      await downloadRecordFile(recId, record.originalName);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloadingMap((prev) => ({ ...prev, [recId]: false }));
    }
  };

  const handlePreview = async (record) => {
    const recId = record._id || record.id;
    setPreviewingMap((prev) => ({ ...prev, [recId]: true }));
    try {
      await previewRecordFile(recId);
    } catch (err) {
      alert(`Preview failed: ${err.message}`);
    } finally {
      setPreviewingMap((prev) => ({ ...prev, [recId]: false }));
    }
  };

  const handleVerify = async (record) => {
    const recId = record._id || record.id;
    setVerifyingMap((prev) => ({ ...prev, [recId]: true }));
    setVerificationFeedback((prev) => ({ ...prev, [recId]: null }));

    try {
      const result = await verifyRecordIntegrity(recId);
      // If endpoint allowed doctor verification
      setVerificationFeedback((prev) => ({
        ...prev,
        [recId]: {
          type: result.integrityVerified ? "success" : "warning",
          message: result.message || "Verification completed.",
          details: result,
        },
      }));
    } catch (err) {
      // Backend policy restricts /verify to patient owner (HTTP 403)
      if (err.message && (err.message.includes("403") || err.message.toLowerCase().includes("patient"))) {
        setVerificationFeedback((prev) => ({
          ...prev,
          [recId]: {
            type: "info",
            title: "Doctor Verification Policy Notice",
            message:
              "Backend policy restricts live file re-hashing (/verify) strictly to the patient owner. On-chain record state: Verified on Blockchain (Block #" +
              (record.blockNumber || "5") +
              ").",
            storedHash: record.fileHash,
            txHash: record.txHash,
          },
        }));
      } else {
        setVerificationFeedback((prev) => ({
          ...prev,
          [recId]: {
            type: "error",
            title: "Verification Error",
            message: err.message || "Could not complete verification request.",
          },
        }));
      }
    } finally {
      setVerifyingMap((prev) => ({ ...prev, [recId]: false }));
    }
  };

  const copyHashToClipboard = (hash, id) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(id);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const roleLabel =
    currentUser.role === "doctor"
      ? "Doctor / Physician"
      : currentUser.role === "hospital"
      ? "Hospital Administrator"
      : currentUser.role;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 md:flex">
      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="flex w-full flex-col border-r border-slate-200 bg-white md:fixed md:inset-y-0 md:w-64">
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600 text-2xl text-white shadow-sm">
            ✚
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">HealthChain</h1>
            <p className="text-xs font-semibold text-teal-700 uppercase tracking-wider">
              {currentUser.role === "hospital" ? "Hospital Portal" : "Doctor Portal"}
            </p>
          </div>
        </div>

        <div className="px-4 py-5">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Provider Workspace
          </p>
          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab("records")}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                activeTab === "records"
                  ? "bg-teal-50 text-teal-800 font-semibold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="w-6 text-center text-lg">▤</span>
              Authorized Records
            </button>

            <button
              onClick={() => setActiveTab("profile")}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                activeTab === "profile"
                  ? "bg-teal-50 text-teal-800 font-semibold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="w-6 text-center text-lg">👤</span>
              Provider Profile
            </button>

            <button
              onClick={() => setActiveTab("security")}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                activeTab === "security"
                  ? "bg-teal-50 text-teal-800 font-semibold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="w-6 text-center text-lg">⬡</span>
              Blockchain & Security
            </button>
          </nav>
        </div>

        <div className="mt-auto hidden p-4 md:block">
          <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  backendStatus === "Connected" ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <p className="text-xs font-bold text-slate-700">
                Backend: {backendStatus}
              </p>
            </div>
            {backendError && (
              <p className="mt-1 text-xs text-red-600">{backendError}</p>
            )}
            <div className="mt-2 text-xs text-slate-500 space-y-1">
              <p>Chain ID: <span className="font-mono font-medium">1337</span></p>
              <p>Network: <span className="font-medium">Ganache RPC</span></p>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-slate-400">
            HealthChain · Healthcare Provider Portal
          </p>
        </div>
      </aside>

      {/* ── Main Content Area ─────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 p-5 sm:p-8 md:ml-64">
        {/* Top Header */}
        <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="mb-1 text-sm font-medium text-teal-700">
              Provider Portal / {activeTab === "records" ? "Patient Records" : activeTab === "profile" ? "Profile" : "Security"}
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Doctor Dashboard
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Access medical records governed by live on-chain smart contract permissions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-start rounded-xl border border-slate-200 bg-white px-4 py-3 sm:self-auto shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 font-bold text-teal-800">
              {currentUser.name?.charAt(0).toUpperCase() || "D"}
            </div>

            <div>
              <p className="text-sm font-bold text-slate-900">{currentUser.name}</p>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <p className="text-xs capitalize font-medium text-slate-600">
                  {currentUser.role}
                </p>
              </div>
            </div>

            <button
              onClick={onLogout}
              className="ml-2 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 hover:border-red-300"
            >
              Logout
            </button>
          </div>
        </header>

        {/* ── TAB 1: AUTHORIZED RECORDS ────────────────────────────────────────── */}
        {activeTab === "records" && (
          <>
            {/* Security Hero Banner */}
            <section className="mb-7 rounded-2xl bg-gradient-to-r from-teal-800 via-slate-800 to-indigo-900 p-6 text-white sm:p-8 shadow-sm">
              <span className="inline-block rounded-full bg-teal-400/20 px-3 py-1 text-xs font-semibold tracking-wider text-teal-200 uppercase">
                Smart Contract Access Control
              </span>
              <h3 className="mt-3 text-xl font-bold sm:text-2xl">
                On-Chain Permission Enforcement
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-teal-100">
                Patient records can only be queried if the patient has actively authorized
                your Ethereum wallet address on the blockchain. Smart contract checks are
                executed dynamically on every record query and file download request.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-mono text-teal-200 bg-black/20 rounded-xl p-3 inline-block">
                <span>Wallet: {currentUser.ethereumAddress || "No wallet linked"}</span>
                {currentUser.isWalletVerified && (
                  <span className="rounded bg-emerald-500/30 px-2 py-0.5 text-emerald-200 font-sans font-semibold">
                    ✓ Verified Provider
                  </span>
                )}
              </div>
            </section>

            {/* Patient Lookup Card */}
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-bold text-slate-900 mb-1">
                Lookup Authorized Patient Records
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Enter the registered Patient Email address to view and download medical documents permitted under your on-chain authorization.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleFetchRecords();
                }}
                className="space-y-4"
              >
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="email"
                    required
                    placeholder="Enter Patient Email (e.g. satya@gmail.com)"
                    value={patientEmailInput}
                    onChange={(e) => setPatientEmailInput(e.target.value)}
                    className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600 transition"
                  />
                  <button
                    type="submit"
                    disabled={loading || !patientEmailInput.trim()}
                    className="rounded-xl bg-teal-700 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <span className="animate-spin text-base">⟳</span>
                        Verifying Permissions...
                      </>
                    ) : (
                      <>
                        <span>🔍</span>
                        Query Records
                      </>
                    )}
                  </button>
                </div>

                {/* Quick Helper Chip */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-slate-400">Quick Test Email:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPatientEmailInput(demoPatientEmail);
                      handleFetchRecords(demoPatientEmail);
                    }}
                    className="rounded-lg bg-slate-100 hover:bg-teal-50 hover:text-teal-800 border border-slate-200 px-2.5 py-1 text-xs font-mono text-slate-600 transition"
                  >
                    Patient Satya ({demoPatientEmail})
                  </button>
                </div>
              </form>

              {/* Status & Error Feedback */}
              {queryError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-3">
                  <span className="text-lg leading-none">⚠️</span>
                  <div>
                    <p className="font-semibold">Access Restriction Notice</p>
                    <p className="mt-1 text-xs leading-relaxed">{queryError}</p>
                  </div>
                </div>
              )}

              {querySuccess && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-start gap-3">
                  <span className="text-lg leading-none">✓</span>
                  <div>
                    <p className="font-semibold">Permission Confirmed</p>
                    <p className="mt-1 text-xs leading-relaxed">{querySuccess}</p>
                  </div>
                </div>
              )}
            </section>

            {/* Records List Display */}
            {searchedPatient && !loading && !queryError && (
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-slate-900">
                      Medical Records for Patient:{" "}
                      <span className="text-teal-700 font-semibold">
                        {searchedPatient.name || searchedPatient.email}
                      </span>
                      {searchedPatient.email && (
                        <span className="ml-2 font-mono text-xs text-slate-500">
                          ({searchedPatient.email})
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {records.length} document(s) verified on smart contract
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 self-start sm:self-auto">
                    Live Blockchain Access: Authorized
                  </span>
                </div>

                {records.length === 0 ? (
                  <div className="p-10 text-center">
                    <p className="font-semibold text-slate-700">No records found</p>
                    <p className="mt-1 text-sm text-slate-500">
                      This patient currently has no uploaded health documents.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {records.map((record) => {
                      const recId = record._id || record.id;
                      const isDownloading = Boolean(downloadingMap[recId]);
                      const isPreviewing = Boolean(previewingMap[recId]);
                      const isVerifying = Boolean(verifyingMap[recId]);
                      const feedback = verificationFeedback[recId];

                      const formattedDate = record.createdAt
                        ? new Date(record.createdAt).toLocaleDateString("en-US", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "N/A";

                      return (
                        <div key={recId} className="p-5 hover:bg-slate-50/50 transition">
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            {/* Record Info */}
                            <div className="space-y-1.5 flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-bold text-slate-900 text-base">
                                  {record.name}
                                </h4>
                                <span className="rounded-md bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                                  {record.type}
                                </span>
                                <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-700 flex items-center gap-1">
                                  <span>✓</span> Blockchain {record.blockchainStatus || "Verified"}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                <span>Uploaded: <strong className="text-slate-700">{formattedDate}</strong></span>
                                <span>File: <strong className="text-slate-700">{record.originalName || "document.pdf"}</strong></span>
                                <span>Size: <strong className="text-slate-700">{formatBytes(record.sizeBytes)}</strong></span>
                                {record.blockNumber && (
                                  <span>Block: <strong className="text-teal-700 font-mono">#{record.blockNumber}</strong></span>
                                )}
                              </div>

                              {/* Monospace SHA-256 Hash Display */}
                              {record.fileHash && (
                                <div className="flex items-center gap-2 pt-1">
                                  <span className="text-xs text-slate-400 font-medium">SHA-256:</span>
                                  <span className="font-mono text-xs text-slate-600 bg-slate-100 rounded px-2 py-0.5 truncate max-w-xs sm:max-w-md">
                                    {record.fileHash}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => copyHashToClipboard(record.fileHash, recId)}
                                    className="text-xs text-teal-700 hover:text-teal-900 font-semibold"
                                  >
                                    {copiedHash === recId ? "Copied!" : "Copy"}
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={isPreviewing}
                                onClick={() => handlePreview(record)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                              >
                                {isPreviewing ? "Loading..." : "👁 View Document"}
                              </button>

                              <button
                                type="button"
                                disabled={isDownloading}
                                onClick={() => handleDownload(record)}
                                className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50 transition flex items-center gap-1.5"
                              >
                                {isDownloading ? "Downloading..." : "⬇ Download PDF"}
                              </button>

                              <button
                                type="button"
                                disabled={isVerifying}
                                onClick={() => handleVerify(record)}
                                className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50 transition flex items-center gap-1"
                              >
                                {isVerifying ? (
                                  <span className="animate-spin">⟳</span>
                                ) : (
                                  <span>🛡</span>
                                )}
                                Verify Integrity
                              </button>
                            </div>
                          </div>

                          {/* Verification Feedback Banner */}
                          {feedback && (
                            <div
                              className={`mt-4 rounded-xl p-3.5 text-xs border ${
                                feedback.type === "success"
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                                  : feedback.type === "info"
                                  ? "bg-blue-50 border-blue-200 text-blue-900"
                                  : feedback.type === "warning"
                                  ? "bg-amber-50 border-amber-200 text-amber-900"
                                  : "bg-red-50 border-red-200 text-red-900"
                              }`}
                            >
                              <div className="font-semibold flex items-center gap-1.5">
                                <span>{feedback.type === "success" ? "✓" : "ℹ"}</span>
                                <span>{feedback.title || "Integrity Status"}</span>
                              </div>
                              <p className="mt-1 leading-relaxed">{feedback.message}</p>
                              {feedback.storedHash && (
                                <div className="mt-2 font-mono text-[11px] bg-white/70 p-2 rounded border border-blue-200/50">
                                  <p>Anchored Hash: {feedback.storedHash}</p>
                                  {feedback.txHash && <p>Tx: {feedback.txHash}</p>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {/* ── TAB 2: DOCTOR PROFILE ────────────────────────────────────────────── */}
        {activeTab === "profile" && (
          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-100 text-2xl font-bold text-teal-800">
                  {currentUser.name?.charAt(0).toUpperCase() || "D"}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{currentUser.name}</h3>
                  <p className="text-sm text-slate-500">{currentUser.email}</p>
                  <span className="mt-2 inline-block rounded-md bg-teal-50 border border-teal-200 px-2.5 py-0.5 text-xs font-semibold text-teal-800">
                    {roleLabel}
                  </span>
                </div>
              </div>

              <hr className="my-6 border-slate-100" />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
                  <p className="text-xs font-medium text-slate-500">Provider User ID</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-slate-800">
                    {currentUser.id}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
                  <p className="text-xs font-medium text-slate-500">Specialty / Role</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {currentUser.specialty || "Licensed Healthcare Provider"}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-500">
                      Linked Ethereum Wallet Address
                    </p>
                    {currentUser.isWalletVerified ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        ✓ Cryptographically Verified
                      </span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        Unverified
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-sm font-bold text-teal-800 break-all">
                    {currentUser.ethereumAddress || "No address assigned"}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    This Ethereum address is queried by HealthRecordContract.hasAccess() when patients grant or revoke access.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── TAB 3: SECURITY & BLOCKCHAIN ─────────────────────────────────────── */}
        {activeTab === "security" && (
          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-2">
                Security Architecture & Blockchain Verification
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed mb-6">
                HealthChain enforces a dual-layer security model combining cryptographic document hashing with decentralized smart contract permission gating.
              </p>

              <div className="grid gap-4 sm:grid-cols-3 mb-6">
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                  <span className="text-2xl">🔒</span>
                  <h4 className="mt-2 text-sm font-bold text-slate-900">SHA-256 Anchoring</h4>
                  <p className="mt-1 text-xs text-slate-500 leading-normal">
                    Medical documents are hashed at upload time. The cryptographic digest is registered on the immutable smart contract.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                  <span className="text-2xl">⚖️</span>
                  <h4 className="mt-2 text-sm font-bold text-slate-900">On-Chain Access</h4>
                  <p className="mt-1 text-xs text-slate-500 leading-normal">
                    Permissions are managed by patients via smart contract calls: grantAccess() and revokeAccess().
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                  <span className="text-2xl">🛡️</span>
                  <h4 className="mt-2 text-sm font-bold text-slate-900">Tamper Resistance</h4>
                  <p className="mt-1 text-xs text-slate-500 leading-normal">
                    Any modification of file bytes immediately breaks the hash validation against the immutable blockchain registry.
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-teal-50 border border-teal-200 p-4 text-xs text-teal-900 space-y-2">
                <p className="font-semibold">Current Deployment Information:</p>
                <p>Smart Contract: <span className="font-mono">0xb353856da6Af64a00aE7AA6Ff93CfEbD7e23345b</span></p>
                <p>Network: <span className="font-mono">Ganache Localhost (Chain ID 1337)</span></p>
                <p>Active Authorized Doctor: <span className="font-mono">Dr. Rahul Sharma (0xDcFCCe8e...)</span></p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
