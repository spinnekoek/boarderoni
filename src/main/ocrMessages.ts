export interface OcrWorkerRequest {
  jpeg: Buffer
}

export interface OcrWorkerResponse {
  text: string
}
