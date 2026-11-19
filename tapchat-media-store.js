/*
 * TapChat media bridge:
 * 1. Upload files to Cloudinary.
 * 2. Keep the Cloudinary secure_url as the media URL.
 * 3. Optionally persist that URL and metadata to Firestore.
 */
(function () {
  "use strict";

  let firestoreConfig = null;

  function setFirestore(config) {
    if (!config) throw new Error("Firestore configuration is required.");
    firestoreConfig = config;
  }

  async function saveProfilePhoto(uid, upload) {
    if (!uid) throw new Error("A signed-in user uid is required.");
    if (!firestoreConfig?.db || !firestoreConfig?.doc || !firestoreConfig?.setDoc) {
      throw new Error("Firestore is not configured for TapChat media uploads.");
    }

    await firestoreConfig.setDoc(
      firestoreConfig.doc(firestoreConfig.db, "users", uid),
      {
        photoURL: upload.url,
        media: {
          provider: "cloudinary",
          publicId: upload.publicId,
          resourceType: upload.resourceType,
          format: upload.format,
          bytes: upload.bytes
        }
      },
      { merge: true }
    );

    return upload.url;
  }

  async function saveChatMedia(conversationId, messageId, uid, upload, text = "") {
    if (!conversationId) throw new Error("A conversationId is required.");
    if (!messageId) throw new Error("A messageId is required.");
    if (!uid) throw new Error("A signed-in user uid is required.");
    if (!firestoreConfig?.db || !firestoreConfig?.doc || !firestoreConfig?.setDoc) {
      throw new Error("Firestore is not configured for TapChat media uploads.");
    }

    const messageRef = firestoreConfig.doc(
      firestoreConfig.db,
      "conversations",
      conversationId,
      "messages",
      messageId
    );

    await firestoreConfig.setDoc(messageRef, {
      senderId: uid,
      text,
      type: upload.resourceType === "video"
        ? "video"
        : upload.resourceType === "audio"
          ? "audio"
          : "image",
      mediaURL: upload.url,
      publicId: upload.publicId,
      resourceType: upload.resourceType,
      format: upload.format,
      bytes: upload.bytes,
      provider: "cloudinary",
      createdAt: firestoreConfig.serverTimestamp
        ? firestoreConfig.serverTimestamp()
        : new Date()
    });

    const conversationRef = firestoreConfig.doc(
      firestoreConfig.db,
      "conversations",
      conversationId
    );
    await firestoreConfig.setDoc(conversationRef, {
      lastMessage: text || `Shared ${upload.resourceType}`,
      lastMediaURL: upload.url,
      updatedAt: firestoreConfig.serverTimestamp
        ? firestoreConfig.serverTimestamp()
        : new Date()
    }, { merge: true });

    return upload.url;
  }

  async function uploadAndSaveProfile(file, uid) {
    if (!window.TapChatCloudinary) throw new Error("cloudinary-media.js must be loaded first.");
    const upload = await window.TapChatCloudinary.upload(file);
    await saveProfilePhoto(uid, upload);
    localStorage.setItem("tapchatProfilePhoto", upload.url);
    return upload;
  }

  async function uploadAndSaveChatMedia(file, { conversationId, messageId, uid, text = "" }) {
    if (!window.TapChatCloudinary) throw new Error("cloudinary-media.js must be loaded first.");
    const upload = await window.TapChatCloudinary.upload(file);
    await saveChatMedia(conversationId, messageId, uid, upload, text);
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
