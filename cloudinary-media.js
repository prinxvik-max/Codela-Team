/* TapChat Cloudinary unsigned media uploads */
(function () {
  "use strict";

  const CLOUDINARY_CLOUD_NAME = "ckmswdoh";
  const CLOUDINARY_UPLOAD_PRESET = "tapchat_media_unsigned";
  const CLOUDINARY_FOLDER = "codela/tapchat/media";

  const ALLOWED_FORMATS = new Set([
    "jpg", "jpeg", "png", "webp", "gif",
    "mp4", "mov", "webm", "mp3", "m4a", "wav", "ogg"
  ]);

  function getExtension(file) {
    const nameExtension = (file.name || "").split(".").pop().toLowerCase();
    if (nameExtension && nameExtension !== (file.name || "").toLowerCase()) return nameExtension;
    const mimeExtension = (file.type || "").split("/").pop().toLowerCase();
    return mimeExtension === "mpeg" ? "mp3" : mimeExtension;
  }

  async function uploadTapChatMedia(file) {
    if (!file) throw new Error("Choose a media file first.");

    const extension = getExtension(file);
    if (!ALLOWED_FORMATS.has(extension)) {
      throw new Error("Unsupported media format. Allowed formats: jpg, jpeg, png, webp, gif, mp4, mov, webm, mp3, m4a, wav, ogg.");
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("folder", CLOUDINARY_FOLDER);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`,
      { method: "POST", body: formData }
    );

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error?.message || "Cloudinary upload failed.");
    }

    return {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      format: result.format,
      bytes: result.bytes,
      result
    };
  }

  window.TapChatCloudinary = {
    cloudName: CLOUDINARY_CLOUD_NAME,
    uploadPreset: CLOUDINARY_UPLOAD_PRESET,
    folder: CLOUDINARY_FOLDER,
    allowedFormats: [...ALLOWED_FORMATS],
    getExtension,
    upload: uploadTapChatMedia
  };
})();
