/* Shared TapChat Cloudinary upload and Firestore persistence helpers. */
(function () {
  "use strict";

  const allowedMedia = ".jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg";
  const allowedImages = ".jpg,.jpeg,.png,.webp,.gif";
  let firebaseSdk;
  let auth;
  let db;
  let currentUser = null;
  let initPromise;

  function toast(message) {
    let node = document.getElementById("tapchatMediaToast");
    if (!node) {
      node = document.createElement("div");
      node.id = "tapchatMediaToast";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.style.cssText = "position:fixed;z-index:99999;left:50%;bottom:24px;transform:translateX(-50%);background:#30271f;color:#fff;padding:12px 16px;border-radius:10px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:90%;text-align:center";
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.style.display = "block";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.style.display = "none"; }, 3200);
  }

  function initialize() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const [firebase, authSdk, firestore] = await Promise.all([
        import("./tapchat-firebase.js"),
        import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js")
      ]);
      auth = firebase.auth;
      db = firebase.db;
      firebaseSdk = { authSdk, firestore };
      authSdk.onAuthStateChanged(auth, async user => {
        currentUser = user;
        if (!user) {
          displayProfilePhoto(null);
          return;
        }

        displayProfilePhoto(user.photoURL);
        try {
          const profile = await firestore.getDoc(firestore.doc(db, "users", user.uid));
          if (currentUser?.uid !== user.uid) return;
          displayProfilePhoto(profile.exists() ? profile.data().photoURL || user.photoURL : user.photoURL);
        } catch (error) {
          console.error("Could not load TapChat profile photo:", error);
        }
      });
    })();
    return initPromise;
  }

  function displayProfilePhoto(url) {
    document.querySelectorAll("#sidebarPhoto, .profile-photo").forEach(image => {
      if (url) image.src = url;
      image.hidden = !url;
    });
    document.querySelectorAll("#sidebarInitials").forEach(initials => {
      initials.hidden = Boolean(url);
    });
  }

  async function requireUser() {
    await initialize();
    if (currentUser) return currentUser;
    return new Promise((resolve, reject) => {
      const unsubscribe = firebaseSdk.authSdk.onAuthStateChanged(auth, user => {
        unsubscribe();
        if (user) resolve(user);
        else reject(new Error("Please sign in before uploading media."));
      }, reject);
    });
  }

  function assertCloudinary() {
    if (!window.TapChatCloudinary) {
      throw new Error("Cloudinary uploader is missing. Load cloudinary-media.js before tapchat-page-media.js.");
    }
  }

  async function upload(file) {
    if (!file) throw new Error("Choose a media file first.");
    assertCloudinary();
    return window.TapChatCloudinary.upload(file);
  }

  async function saveProfilePhoto(uploaded) {
    const user = await requireUser();
    const { doc, setDoc, serverTimestamp } = firebaseSdk.firestore;
    await setDoc(doc(db, "users", user.uid), {
      photoURL: uploaded.url,
      photoPublicId: uploaded.publicId,
      photoResourceType: uploaded.resourceType,
      photoFormat: uploaded.format,
      photoBytes: uploaded.bytes,
      mediaProvider: "cloudinary",
      updatedAt: serverTimestamp()
    }, { merge: true });
    displayProfilePhoto(uploaded.url);
    return uploaded.url;
  }

  function getActiveConversationId() {
    if (typeof window.tapchatConversationId === "string" && window.tapchatConversationId) {
      return window.tapchatConversationId;
    }
    const query = new URLSearchParams(window.location.search);
    const explicitId = query.get("conversationId");
    if (explicitId) return explicitId;
    const friendId = query.get("friendId");
    if (friendId && currentUser) return [currentUser.uid, friendId].sort().join("__");
    return null;
  }

  async function saveChatMedia(uploaded, caption = "", conversationId = getActiveConversationId()) {
    const user = await requireUser();
    if (!conversationId) throw new Error("Select a private conversation before attaching media.");
    const { collection, doc, setDoc, serverTimestamp } = firebaseSdk.firestore;
    const messageRef = doc(collection(db, "conversations", conversationId, "messages"));
    const type = uploaded.resourceType === "video" ? "video"
      : uploaded.resourceType === "audio" ? "audio" : "image";
    const message = {
      senderId: user.uid,
      text: caption,
      type,
      mediaURL: uploaded.url,
      publicId: uploaded.publicId,
      resourceType: uploaded.resourceType,
      format: uploaded.format,
      bytes: uploaded.bytes,
      provider: "cloudinary",
      createdAt: serverTimestamp()
    };
    await setDoc(messageRef, message);
    await setDoc(doc(db, "conversations", conversationId), {
      lastMessage: caption || `Shared ${type}`,
      lastMediaURL: uploaded.url,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return { ...message, id: messageRef.id };
  }

  function appendMedia(uploaded, caption = "") {
    const area = document.getElementById("messagesArea") || document.getElementById("messageHistory");
    if (!area) return;
    const element = uploaded.resourceType === "video"
      ? Object.assign(document.createElement("video"), { controls: true, preload: "metadata", src: uploaded.url })
      : uploaded.resourceType === "audio"
        ? Object.assign(document.createElement("audio"), { controls: true, preload: "metadata", src: uploaded.url })
        : Object.assign(document.createElement("img"), { alt: "Shared media", src: uploaded.url });
    element.style.maxWidth = "min(360px, 100%)";
    element.style.borderRadius = "12px";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (caption) {
      const text = document.createElement("p");
      text.textContent = caption;
      bubble.appendChild(text);
    }
    bubble.appendChild(element);
    const row = document.createElement("div");
    row.className = "message-row mine";
    row.appendChild(bubble);
    area.appendChild(row);
    area.scrollTop = area.scrollHeight;
  }

  function connectProfilePhotoInputs() {
    document.querySelectorAll("input[type='file'][id*='Photo'], input[type='file'][accept*='image']").forEach(input => {
      if (input.dataset.tapchatConnected) return;
      input.dataset.tapchatConnected = "true";
      input.accept = allowedImages;
      input.addEventListener("change", async event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
          toast("Uploading profile picture...");
          const uploaded = await upload(file);
          await saveProfilePhoto(uploaded);
          toast("Profile picture saved to Cloudinary and Firestore.");
        } catch (error) {
          console.error("Profile photo upload failed:", error);
          toast(error.message || "Profile photo upload failed.");
        } finally {
          input.value = "";
        }
      }, true);
    });
  }

  function connectChatAttachment() {
    const form = document.querySelector("[data-tapchat-chat-media]");
    if (!form || document.getElementById("tapchatMediaInput")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "tapchatMediaButton";
    button.className = "attachment-button";
    button.textContent = "+";
    button.title = "Attach image, video, or audio";
    button.setAttribute("aria-label", button.title);
    button.disabled = Boolean(document.getElementById("messageInput")?.disabled);
    const picker = document.createElement("input");
    picker.type = "file";
    picker.id = "tapchatMediaInput";
    picker.accept = allowedMedia;
    picker.hidden = true;
    button.addEventListener("click", () => picker.click());
    form.insertBefore(button, form.firstChild);
    form.appendChild(picker);
    picker.addEventListener("change", async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const textInput = document.getElementById("messageInput");
      const caption = textInput && textInput.value ? textInput.value.trim() : "";
      const conversationId = getActiveConversationId();
      try {
        if (!conversationId) throw new Error("Select a private conversation before attaching media.");
        toast("Uploading media to Cloudinary...");
        const uploaded = await upload(file);
        await saveChatMedia(uploaded, caption, conversationId);
        if (textInput) textInput.value = "";
        toast("Media URL saved to Firestore.");
      } catch (error) {
        console.error("Chat media upload failed:", error);
        toast(error.message || "Media upload failed.");
      } finally {
        picker.value = "";
      }
    });
  }

  function start() {
    initialize().catch(error => console.error("TapChat Firebase media setup failed:", error));
    connectProfilePhotoInputs();
    connectChatAttachment();
    new MutationObserver(() => {
      connectProfilePhotoInputs();
      connectChatAttachment();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.TapChatMediaPage = { upload, saveProfilePhoto, saveChatMedia, appendMedia, toast };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
