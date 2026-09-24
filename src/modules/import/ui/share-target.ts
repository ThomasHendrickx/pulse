// The share-sheet entry point's two names (M3-P5, DR-0021). One definition,
// read by the web app manifest that declares the share target, the route
// that receives it, and the middleware that treats an unauthenticated share
// differently from every other request. Three copies of a path drift; a
// share target whose declared action and receiving route disagree fails
// only on the owner's phone.

// The route the phone's share sheet POSTs the shared file to. English only,
// like every URL path (CLAUDE.md non-negotiable 2).
export const SHARE_TARGET_PATH = "/import/share";

// The multipart field the manifest's share_target.params.files entry names,
// the same field the upload form's file input uses, so the receiving route
// reads a share exactly as the upload action reads an upload.
export const SHARE_TARGET_FILE_FIELD = "file";
