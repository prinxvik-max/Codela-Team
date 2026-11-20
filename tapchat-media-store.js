/* TapChat media bridge: upload files to Cloudinary and persist URLs/metadata in Firestore. */
(function () {
  "use strict";

  let firestoreConfig = null;

  function setFirestore(config) {
    if (!config || !config.db || !config.doc || !config.setDoc) {
      throw new Error("A valid Firestore configuration is required.");
    }
    firestoreConfig = config;
  }

  function requireFirestore() {
    if (!firestoreConfig) throw new Error("Firestore is not configured for TapChat media uploads.");
    return firestoreConfig;
  }

  function requireUpload(upload) {
    if (!upload || !upload.url || !upload.publicId) {
      throw new Error("Cloudinary did not return a valid media URL and public ID.");
    }
  }

  async function saveProfilePhoto(uid, upload) {
    if (!uid) throw new Error("A signed-in user uid is required.");
    requireUpload(upload);
    const config = requireFirestore();
    const profileData = {
      photoURL: upload.url,
      media: {
        provider: "cloudinary",
        publicId: upload.publicId,
        resourceType: upload.resourceType,
        format: upload.format,
        bytes: upload.bytes
      },
      updatedAt: config.serverTimestamp ? config.serverTimestamp() : new Date()
    };
    await Promise.all([
      config.setDoc(config.doc(config.db, "users", uid), profileData, { merge: true }),
      config.setDoc(config.doc(config.db, "publicProfiles", uid), {
        uid,
        photoURL: upload.url,
        updatedAt: profileData.updatedAt
      }, { merge: true })
    ]);
    return upload.url;
  }

  async function saveChatMedia(conversationId, messageId, uid, upload, text = "") {
    if (!conversationId) throw new Error("A conversationId is required.");
    if (!messageId) throw new Error("A messageId is required.");
    if (!uid) throw new Error("A signed-in user uid is required.");
    requireUpload(upload);
    const config = requireFirestore();
    const type = upload.resourceType === "video" ? "video"
      : upload.resourceType === "audio" ? "audio" : "image";
    const timestamp = config.serverTimestamp ? config.serverTimestamp() : new Date();

    await config.setDoc(config.doc(config.db, "conversations", conversationId, "messages", messageId), {
      senderId: uid,
      text,
      type,
      mediaURL: upload.url,
      publicId: upload.publicId,
      resourceType: upload.resourceType,
      format: upload.format,
      bytes: upload.bytes,
      provider: "cloudinary",
      createdAt: timestamp
    });

    await config.setDoc(config.doc(config.db, "conversations", conversationId), {
      lastMessage: text || `Shared ${type}`,
      lastMediaURL: upload.url,
      updatedAt: config.serverTimestamp ? config.serverTimestamp() : new Date()
    }, { merge: true });
    return upload.url;
  }

  async function uploadAndSaveProfile(file, uid) {
    if (!window.TapChatCloudinary) throw new Error("cloudinary-media.js must be loaded first.");
    const upload = await window.TapChatCloudinary.upload(file);
    await saveProfilePhoto(uid, upload);
    return upload;
  }

  async function uploadAndSaveChatMedia(file, options) {
    if (!window.TapChatCloudinary) throw new Error("cloudinary-media.js must be loaded first.");
    if (!options) throw new Error("Chat media options are required.");
    const upload = await window.TapChatCloudinary.upload(file);
    await saveChatMedia(options.conversationId, options.messageId, options.uid, upload, options.text || "");
    return upload;
  }

  window.TapChatMediaStore = {
    setFirestore,
    saveProfilePhoto,
    saveChatMedia,
    uploadAndSaveProfile,
    uploadAndSaveChatMedia
  };
})();
