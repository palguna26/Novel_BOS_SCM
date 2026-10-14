-- The document picker accepts JPG and PNG alongside PDF and office files.
-- Keep the bucket's existing MIME types when enabling image attachments.
update storage.buckets
set allowed_mime_types = array(
  select distinct mime
  from unnest(
    coalesce(allowed_mime_types, array[]::text[])
    || array['image/jpeg', 'image/png']
  ) as types(mime)
)
where id = 'scm-documents';
