## Upload file types

Uploads infer each file's MIME type from its filename extension, case-insensitively. PNG, JPEG/JPG, BMP, and other recognized extensions receive their corresponding MIME types.

The uploaded browser file's `File.type` matches the inferred MIME type. Unknown extensions and filenames without an extension produce an empty `File.type`.

Inference uses the filename only. A renamed file receives the type associated with its extension, and the receiving site can reject its contents.
