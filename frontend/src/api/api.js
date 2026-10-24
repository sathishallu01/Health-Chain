const API_BASE_URL = "http://localhost:5000";

export async function checkBackendHealth() {
  const response = await fetch(`${API_BASE_URL}/api/health`);

  if (!response.ok) {
    throw new Error(`Backend returned status ${response.status}`);
  }

  return response.json();
}

export async function registerPatient({ name, email, password }) {
  const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Registration failed.");
  }

  return data;
}

export async function registerDoctor({ name, email, specialty, organization, password, confirmPassword }) {
  const response = await fetch(`${API_BASE_URL}/api/auth/register-doctor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, email, specialty, organization, password, confirmPassword }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Doctor registration failed.");
  }

  return data;
}

export async function loginPatient({ email, password }) {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Login failed.");
  }

  return data;
}

/**
 * Fetch all health records belonging to the authenticated patient.
 *
 * @param {string} [token] - Optional JWT token; defaults to sessionStorage.getItem("healthchain_token")
 * @returns {Promise<{ records: Array, count: number }>}
 */
export async function getPatientRecords(token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(`${API_BASE_URL}/api/records`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Failed to fetch records (${response.status})`);
  }

  return data;
}

/**
 * Upload a health record file with metadata using FormData.
 * Browser automatically computes and sets the multipart boundary header.
 *
 * @param {Object} params
 * @param {string} params.name - Human-readable record name
 * @param {string} params.type - Record category
 * @param {File}   params.file - PDF, PNG, or JPEG file
 * @param {string} [token]     - Optional JWT token
 * @returns {Promise<{ message: string, record: Object }>}
 */
export async function uploadPatientRecord({ name, type, file }, token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const formData = new FormData();
  formData.append("name", name);
  formData.append("type", type);
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/records`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Upload failed (${response.status})`);
  }

  return data;
}

/**
 * Verify integrity of a patient health record against the stored file and blockchain.
 *
 * @param {string} recordId - MongoDB ObjectId string of the record
 * @param {string} [token]  - Optional JWT token; defaults to sessionStorage.getItem("healthchain_token")
 * @returns {Promise<{ integrityVerified: boolean, fileMatchesDatabase: boolean, hashRegisteredOnBlockchain: boolean, message: string }>}
 */
export async function verifyRecordIntegrity(recordId, token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(`${API_BASE_URL}/api/records/${recordId}/verify`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Verification request failed (${response.status})`);
  }

  return data;
}

/**
 * Register/anchor a patient health record's SHA-256 hash onto the blockchain.
 *
 * @param {string} recordId - MongoDB ObjectId string of the record
 * @param {string} [token]  - Optional JWT token
 * @returns {Promise<{ success: boolean, message: string, txHash: string, blockNumber: number }>}
 */
export async function registerRecordToBlockchain(recordId, token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(`${API_BASE_URL}/api/records/${recordId}/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Failed to register on blockchain (${response.status})`);
  }

  return data;
}

/**
 * Fetch all registered healthcare providers with live on-chain access status.
 *
 * @param {string} [token] - Optional JWT token
 * @returns {Promise<{ success: boolean, providers: Array }>}
 */
export async function getProvidersList(token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(`${API_BASE_URL}/api/access/providers`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Failed to fetch providers (${response.status})`);
  }

  return data;
}

/**
 * Grant a healthcare provider on-chain access to patient records.
 *
 * @param {string} providerId - MongoDB ObjectId string of the provider
 * @param {string} [token]    - Optional JWT token
 * @returns {Promise<{ success: boolean, message: string, txHash: string, access: boolean }>}
 */
export async function grantProviderAccess(providerId, token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(`${API_BASE_URL}/api/access/grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ providerId }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Failed to grant access (${response.status})`);
  }

  return data;
}

/**
 * Revoke a healthcare provider's on-chain access to patient records.
 *
 * @param {string} providerId - MongoDB ObjectId string of the provider
 * @param {string} [token]    - Optional JWT token
 * @returns {Promise<{ success: boolean, message: string, txHash: string, access: boolean }>}
 */
export async function revokeProviderAccess(providerId, token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(`${API_BASE_URL}/api/access/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ providerId }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Failed to revoke access (${response.status})`);
  }

  return data;
}

/**
 * Fetch health records for a specific patient by patient ID as an authorized healthcare provider.
 * Requires doctor or hospital role with active on-chain permission.
 *
 * @param {string} patientId - MongoDB ObjectId string of the patient
 * @param {string} [token]   - Optional JWT token; defaults to sessionStorage
 * @returns {Promise<{ success: boolean, records: Array, count: number }>}
 */
export async function getPatientRecordsForDoctor(patientId, token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(`${API_BASE_URL}/api/records/patient/${patientId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || `Failed to fetch patient records (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return data;
}

/**
 * Fetch health records for a specific patient by email as an authorized healthcare provider.
 * Resolves patient email to user ID and verifies active on-chain permission.
 *
 * @param {string} email   - Registered patient email address
 * @param {string} [token] - Optional JWT token; defaults to sessionStorage
 * @returns {Promise<{ success: boolean, patient: { id: string, name: string, email: string }, records: Array, count: number }>}
 */
export async function getPatientRecordsByEmailForDoctor(email, token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(
    `${API_BASE_URL}/api/records/patient-by-email?email=${encodeURIComponent(email.trim().toLowerCase())}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || `Failed to fetch patient records (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return data;
}

/**
 * Download a health record file securely using authenticated JWT bearer token.
 *
 * @param {string} recordId     - MongoDB ObjectId string of the record
 * @param {string} originalName - Suggested filename for download
 * @param {string} [token]      - Optional JWT token; defaults to sessionStorage
 */
export async function downloadRecordFile(recordId, originalName, token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(`${API_BASE_URL}/api/records/${recordId}/file`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    let errMsg = `Failed to download file (${response.status})`;
    try {
      const errData = await response.json();
      if (errData.message) errMsg = errData.message;
    } catch {
      // not JSON
    }
    const error = new Error(errMsg);
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = originalName || `record-${recordId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

/**
 * Open a health record file preview in a new browser tab securely using authenticated JWT.
 *
 * @param {string} recordId - MongoDB ObjectId string of the record
 * @param {string} [token]  - Optional JWT token; defaults to sessionStorage
 */
export async function previewRecordFile(recordId, token) {
  const authToken = token || sessionStorage.getItem("healthchain_token");

  if (!authToken) {
    throw new Error("Authentication token not found. Please log in.");
  }

  const response = await fetch(`${API_BASE_URL}/api/records/${recordId}/file`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    let errMsg = `Failed to preview file (${response.status})`;
    try {
      const errData = await response.json();
      if (errData.message) errMsg = errData.message;
    } catch {
      // not JSON
    }
    const error = new Error(errMsg);
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => window.URL.revokeObjectURL(url), 10000);
}
