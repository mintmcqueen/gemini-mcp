export interface GeminiMessage {
  role: "user" | "model";
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

export interface GeminiRequest {
  contents: GeminiMessage[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
  };
}

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export interface FileUpload {
  name: string;
  mimeType: string;
  data: string; // base64 encoded
}

export interface ChatArgs {
  message: string;
  files?: FileUpload[];
  temperature?: number;
  maxTokens?: number;
}

export function isValidChatArgs(args: any): args is ChatArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    "message" in args &&
    typeof args.message === "string" &&
    (args.files === undefined || Array.isArray(args.files)) &&
    (args.temperature === undefined || typeof args.temperature === "number") &&
    (args.maxTokens === undefined || typeof args.maxTokens === "number")
  );
}

export interface ConversationSession {
  id: string;
  messages: GeminiMessage[];
  createdAt: Date;
  lastActivity: Date;
}

export interface UploadedFile {
  name: string;
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  updateTime: string;
  expirationTime: string;
  sha256Hash: string;
  uri: string;
  state: string;
}

// Batch API types

export enum BatchJobState {
  JOB_STATE_PENDING = "JOB_STATE_PENDING",
  JOB_STATE_RUNNING = "JOB_STATE_RUNNING",
  JOB_STATE_SUCCEEDED = "JOB_STATE_SUCCEEDED",
  JOB_STATE_FAILED = "JOB_STATE_FAILED",
  JOB_STATE_CANCELLED = "JOB_STATE_CANCELLED",
  JOB_STATE_EXPIRED = "JOB_STATE_EXPIRED",
}

export interface BatchJob {
  name: string;
  displayName?: string;
  state: BatchJobState | string;
  createTime?: string;
  updateTime?: string;
  completionTime?: string;
  dest?: {
    fileName?: string;
    inlinedResponses?: any[];
    inlinedEmbedContentResponses?: any[];
  };
  inputConfig?: {
    fileName?: string;
    requests?: { requests: any[] };
  };
  batchStats?: {
    successfulRequestCount?: number;
    failedRequestCount?: number;
    totalRequestCount?: number;
  };
  error?: any;
}

export enum EmbeddingTaskType {
  SEMANTIC_SIMILARITY = "SEMANTIC_SIMILARITY",
  CLASSIFICATION = "CLASSIFICATION",
  CLUSTERING = "CLUSTERING",
  RETRIEVAL_DOCUMENT = "RETRIEVAL_DOCUMENT",
  RETRIEVAL_QUERY = "RETRIEVAL_QUERY",
  CODE_RETRIEVAL_QUERY = "CODE_RETRIEVAL_QUERY",
  QUESTION_ANSWERING = "QUESTION_ANSWERING",
  FACT_VERIFICATION = "FACT_VERIFICATION",
}

export interface ContentIngestionReport {
  sourceFile: string;
  outputFile: string;
  sourceFormat: string;
  totalRequests: number;
  validationPassed: boolean;
  errors: string[];
  analysisScripts?: string[];
  extractionScripts?: string[];
}

export interface BatchCreateParams {
  model: string;
  requests?: any[];
  inputFileUri?: string;
  displayName?: string;
  outputLocation?: string;
  config?: {
    systemInstruction?: any;
    temperature?: number;
    maxOutputTokens?: number;
    [key: string]: any;
  };
}

export interface BatchEmbeddingParams {
  model: string;
  requests?: any[];
  inputFileUri?: string;
  taskType: EmbeddingTaskType | string;
  displayName?: string;
  outputLocation?: string;
}