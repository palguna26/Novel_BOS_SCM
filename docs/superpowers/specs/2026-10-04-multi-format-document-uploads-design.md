# Multi-format document uploads

## Goal

Accept PDF, XLSX, CSV, and DOCX files in PO intake, appointment, POD, and invoice uploads. Parse files in the browser, keep extracted values editable, and retain the original file.

## Design

- Use one shared browser parser for all upload flows.
- Convert each supported format to plain text and send it with the original file to `POST /api/documents/extract` as optional `extractedText` multipart data.
- Scan every non-empty XLSX worksheet. Preserve CSV rows and columns as newline/tab-separated text.
- Limit uploads to 10 MB and validate extension, media type, and file content in the web app and API.
- Keep the current server PDF parser as a fallback for API clients that do not send `extractedText`.
- Store unreadable allowed files and return manual-review warnings. Reject unsupported, mismatched, or oversized files.
- Keep the current response and database model unchanged.

## Verification

- Cover every supported format, multi-sheet XLSX, quoted CSV, corrupt or protected files, size limits, mismatches, and PDF fallback.
- Confirm each upload screen accepts all formats and allows manual correction.
- Run the API tests/build and web build.

## Exclusions

Legacy `.xls` and `.doc` files are not supported.
