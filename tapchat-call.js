import { auth, db } from "./tapchat-firebase.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const defaultRtcConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    ...(Array.isArray(window.TAPCHAT_ICE_SERVERS) ? window.TAPCHAT_ICE_SERVERS : [])
  ]
};

function pairId(uid1, uid2) {
  return [uid1, uid2].sort().join("__");
}

export function createCallManager() {
  const dialog = document.createElement("dialog");
  dialog.className = "tapchat-call-dialog";
  dialog.setAttribute("aria-labelledby", "tapchatCallTitle");
  dialog.innerHTML = `
    <div class="tapchat-call-shell">
      <header class="tapchat-call-header">
        <div>
          <h2 id="tapchatCallTitle">TapChat call</h2>
          <p class="tapchat-call-status" id="tapchatCallStatus" aria-live="polite"></p>
        </div>
        <button type="button" class="tapchat-call-close" aria-label="Close call window">×</button>
      </header>
      <p class="tapchat-call-error" id="tapchatCallError" role="alert" hidden></p>
      <div class="tapchat-call-media" id="tapchatCallMedia"></div>
      <div class="tapchat-call-incoming" id="tapchatCallIncoming" hidden>
        <button type="button" class="tapchat-call-decline">Decline</button>
        <button type="button" class="tapchat-call-accept">Join call</button>
      </div>
      <div class="tapchat-call-controls" id="tapchatCallControls" hidden>
        <button type="button" class="tapchat-call-mute">Mute microphone</button>
        <button type="button" class="tapchat-call-camera">Turn camera off</button>
        <button type="button" class="tapchat-call-end">Leave call</button>
      </div>
    </div>
  `;
  document.body.append(dialog);

  const title = dialog.querySelector("#tapchatCallTitle");
  const status = dialog.querySelector("#tapchatCallStatus");
  const error = dialog.querySelector("#tapchatCallError");
  const media = dialog.querySelector("#tapchatCallMedia");
  const incomingActions = dialog.querySelector("#tapchatCallIncoming");
  const callControls = dialog.querySelector("#tapchatCallControls");
  const acceptButton = dialog.querySelector(".tapchat-call-accept");
  const muteButton = dialog.querySelector(".tapchat-call-mute");
  const cameraButton = dialog.querySelector(".tapchat-call-camera");
  let user = auth.currentUser;
  let callsUnsubscribe = null;
  let rtcConfiguration = defaultRtcConfiguration;
  let call = null;
  let callSetupInProgress = false;
  let acceptingCall = false;
  const incomingCallIds = new Set();

  async function refreshRtcConfiguration() {
    const endpoint = window.TAPCHAT_ICE_CONFIG_URL;
    if (!endpoint) {
      rtcConfiguration = defaultRtcConfiguration;
      return;
    }

    const endpointUrl = new URL(endpoint, window.location.href);
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (endpointUrl.protocol !== "https:" && !localHosts.has(endpointUrl.hostname)) {
      throw new Error("The ICE credential endpoint must use HTTPS.");
    }

    const idToken = await user.getIdToken();
    const response = await fetch(endpointUrl, {
      headers: { Authorization: `Bearer ${idToken}` },
      credentials: "omit"
    });
    if (!response.ok) {
      throw new Error(`Could not load secure call network settings (${response.status}).`);
    }

    const settings = await response.json();
    if (
      !Array.isArray(settings.iceServers) ||
      settings.iceServers.length === 0 ||
      settings.iceServers.some(server =>
        !server || !(typeof server.urls === "string" || Array.isArray(server.urls))
      )
    ) {
      throw new Error("The ICE credential endpoint returned invalid server settings.");
    }

    rtcConfiguration = {
      iceServers: [...defaultRtcConfiguration.iceServers, ...settings.iceServers]
    };
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    if (!dialog.open) {
      title.textContent = "Call unavailable";
      status.textContent = "Check your connection and permissions.";
      incomingActions.hidden = true;
      callControls.hidden = true;
      dialog.showModal();
    }
  }

  function clearError() {
    error.textContent = "";
    error.hidden = true;
  }

  function setDialogContent({ callTitle, callStatus, incoming = false, type = "audio" }) {
    title.textContent = callTitle;
    status.textContent = callStatus;
    incomingActions.hidden = !incoming;
    callControls.hidden = incoming;
    cameraButton.hidden = type !== "video";
    dialog.dataset.callKind = type;
    clearError();
  }

  function localMediaTile(stream, type) {
    if (type !== "video") return;
    const tile = document.createElement("div");
    tile.className = "tapchat-call-tile tapchat-call-local";
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const label = document.createElement("span");
    label.textContent = "You";
    tile.append(video, label);
    media.append(tile);
  }

  function addRemoteMedia(peerUid, stream, type) {
    if (media.querySelector(`[data-peer-uid="${CSS.escape(peerUid)}"]`)) return;
    const tile = document.createElement("div");
    tile.className = "tapchat-call-tile";
    tile.dataset.peerUid = peerUid;

    const player = document.createElement(type === "video" ? "video" : "audio");
    player.autoplay = true;
    player.playsInline = true;
    player.srcObject = stream;
    const label = document.createElement("span");
    label.textContent = call?.participantNames?.[peerUid] || "Participant";
    tile.append(player, label);
    media.append(tile);
  }

  function appendCandidate(candidateCollection, candidate) {
    return addDoc(candidateCollection, candidate.toJSON());
  }

  function watchCandidates(candidateCollection, peerConnection) {
    const seen = new Set();
    const pending = [];
    const addCandidate = candidate => {
      if (!peerConnection.remoteDescription) {
        pending.push(candidate);
        return;
      }
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(showError);
    };
    const unsubscribe = onSnapshot(candidateCollection, snapshot => {
      for (const change of snapshot.docChanges()) {
        if (change.type !== "added" || seen.has(change.doc.id)) continue;
        seen.add(change.doc.id);
        addCandidate(change.doc.data());
      }
    }, showError);
    return {
      unsubscribe,
      flush() {
        while (peerConnection.remoteDescription && pending.length) {
          addCandidate(pending.shift());
        }
      }
    };
  }

  function flushCandidateQueues() {
    for (const watcher of call.candidateWatchers) watcher.flush();
  }

  function makePeerConnection(peerUid, peerRef, isOfferer) {
    const peerConnection = new RTCPeerConnection(rtcConfiguration);
    const pendingCandidates = [];
    let candidatesReady = !isOfferer;
    call.peerConnections.set(peerUid, peerConnection);
    for (const track of call.localStream.getTracks()) {
      peerConnection.addTrack(track, call.localStream);
    }
    peerConnection.ontrack = event => {
      if (event.streams[0]) addRemoteMedia(peerUid, event.streams[0], call.type);
    };
    peerConnection.onconnectionstatechange = () => {
      if (call) {
        const connectedCount = [...call.peerConnections.values()]
          .filter(connection => connection.connectionState === "connected").length;
        status.textContent = connectedCount
          ? `Connected with ${connectedCount} ${connectedCount === 1 ? "participant" : "participants"}`
          : "Connecting to participants…";
      }
      if (peerConnection.connectionState === "failed") {
        showError("Could not connect. Check your network or TURN-server setup.");
      }
    };
    const outgoingCandidates = collection(peerRef, isOfferer ? "callerCandidates" : "calleeCandidates");
    peerConnection.onicecandidate = event => {
      if (!event.candidate) return;
      if (!candidatesReady) {
        pendingCandidates.push(event.candidate);
        return;
      }
      appendCandidate(outgoingCandidates, event.candidate).catch(showError);
    };
    peerConnection.tapchatFlushCandidates = () => {
      candidatesReady = true;
      while (pendingCandidates.length) {
        appendCandidate(outgoingCandidates, pendingCandidates.shift()).catch(showError);
      }
    };
    return peerConnection;
  }

  async function createOffer(peerUid) {
    const peerRef = doc(db, "calls", call.id, "connections", pairId(user.uid, peerUid));
    const peerConnection = makePeerConnection(peerUid, peerRef, true);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await setDoc(peerRef, {
      participants: [user.uid, peerUid].sort(),
      offererId: user.uid,
      offer: { type: offer.type, sdp: offer.sdp },
      createdAt: serverTimestamp()
    }, { merge: true });
    peerConnection.tapchatFlushCandidates();

    const answerUnsubscribe = onSnapshot(peerRef, async snapshot => {
      const answer = snapshot.data()?.answer;
      if (!answer || peerConnection.remoteDescription) return;
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        flushCandidateQueues();
      } catch (connectionError) {
        showError(connectionError.message || "Could not complete the call connection.");
      }
    }, showError);
    call.connectionUnsubscribes.push(answerUnsubscribe);
    const candidateWatcher = watchCandidates(
      collection(peerRef, "calleeCandidates"),
      peerConnection
    );
    call.candidateWatchers.push(candidateWatcher);
    call.connectionUnsubscribes.push(candidateWatcher.unsubscribe);
  }

  async function acceptOffer(peerUid, peerRef, offer) {
    const peerConnection = makePeerConnection(peerUid, peerRef, false);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await updateDoc(peerRef, {
      answer: { type: answer.type, sdp: answer.sdp }
    });
    const candidateWatcher = watchCandidates(
      collection(peerRef, "callerCandidates"),
      peerConnection
    );
    call.candidateWatchers.push(candidateWatcher);
    call.connectionUnsubscribes.push(candidateWatcher.unsubscribe);
  }

  function observePeer(peerUid) {
    if (peerUid === user.uid || call.peerConnections.has(peerUid) || call.peerObservers.has(peerUid)) return;
    const peerRef = doc(db, "calls", call.id, "connections", pairId(user.uid, peerUid));

    if (user.uid < peerUid) {
      call.peerObservers.set(peerUid, true);
      createOffer(peerUid).catch(showError);
      return;
    }

    const unsubscribe = onSnapshot(peerRef, snapshot => {
      const data = snapshot.data();
      if (!data?.offer || call.peerConnections.has(peerUid)) return;
      acceptOffer(peerUid, peerRef, data.offer).catch(showError);
    }, showError);
    call.peerObservers.set(peerUid, unsubscribe);
  }

  function watchParticipants() {
    const participants = collection(db, "calls", call.id, "participants");
    call.participantsUnsubscribe = onSnapshot(participants, snapshot => {
      const activeIds = new Set();
      for (const participantDoc of snapshot.docs) {
        if (participantDoc.data().state !== "active") continue;
        const peerUid = participantDoc.id;
        activeIds.add(peerUid);
        observePeer(peerUid);
      }

      for (const [peerUid, peerConnection] of call.peerConnections) {
        if (activeIds.has(peerUid)) continue;
        peerConnection.close();
        call.peerConnections.delete(peerUid);
        media.querySelector(`[data-peer-uid="${CSS.escape(peerUid)}"]`)?.remove();
        const observer = call.peerObservers.get(peerUid);
        if (typeof observer === "function") observer();
        call.peerObservers.delete(peerUid);
      }
    }, showError);
  }

  async function enterCall(callId, details, stream, isCaller) {
    const activeCall = {
      id: callId,
      type: details.type,
      title: details.title || details.conversationName || "TapChat call",
      participantIds: details.participantIds || [],
      participantNames: details.participantNames || {},
      conversationId: details.conversationId || null,
      groupId: details.groupId || null,
      localStream: stream,
      isCaller,
      peerConnections: new Map(),
      peerObservers: new Map(),
      connectionUnsubscribes: [],
      candidateWatchers: [],
      participantsUnsubscribe: null,
      callUnsubscribe: null
    };
    const participantsRef = doc(db, "calls", callId, "participants", user.uid);
    await setDoc(participantsRef, {
      uid: user.uid,
      displayName: user.displayName || "TapChat user",
      state: "active",
      joinedAt: serverTimestamp()
    }, { merge: true });

    call = activeCall;
    media.replaceChildren();
    localMediaTile(stream, details.type);
    setDialogContent({
      callTitle: call.title,
      callStatus: "Waiting for participants to connect…",
      type: call.type
    });
    callControls.hidden = false;
    dialog.showModal();
    watchParticipants();
    call.callUnsubscribe = onSnapshot(doc(db, "calls", callId), snapshot => {
      if (!snapshot.exists() || snapshot.data().status === "ended") {
        finishCall(false);
      }
    }, showError);
  }

  async function startCall({
    type,
    participantIds,
    participantNames = {},
    title,
    conversationId,
    groupId
  }) {
    if (!user) {
      showError("Sign in before starting a call.");
      dialog.showModal();
      return;
    }
    if (call || callSetupInProgress) {
      showError("Leave the current call before starting another.");
      dialog.showModal();
      return;
    }

    if (!Array.isArray(participantIds) || !["audio", "video"].includes(type)) {
      showError("This conversation has invalid call settings.");
      return;
    }

    const members = [...new Set([user.uid, ...participantIds].filter(Boolean))];
    if (members.length < 2) {
      showError("This conversation has no other members to call.");
      dialog.showModal();
      return;
    }
    if (members.length > 6) {
      showError("Group calls support up to six participants.");
      dialog.showModal();
      return;
    }

    let stream;
    let callRef;
    callSetupInProgress = true;
    try {
      await refreshRtcConfiguration();
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Calls require camera/microphone access on a secure HTTPS page.");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === "video"
      });
      callRef = await addDoc(collection(db, "calls"), {
        callerId: user.uid,
        participantIds: members,
        participantNames,
        type,
        title,
        conversationId: conversationId || null,
        groupId: groupId || null,
        status: "active",
        createdAt: serverTimestamp()
      });
      await enterCall(callRef.id, {
        type,
        title,
        participantIds: members,
        participantNames,
        conversationId,
        groupId
      }, stream, true);
    } catch (callError) {
      if (callRef) {
        updateDoc(doc(db, "calls", callRef.id), {
          status: "ended",
          endedAt: serverTimestamp()
        }).catch(console.error);
      }
      stream?.getTracks().forEach(track => track.stop());
      showError(callError.message || "Could not start the call. Check camera and microphone permissions.");
      dialog.showModal();
    } finally {
      callSetupInProgress = false;
    }
  }

  async function acceptIncomingCall() {
    if (!call || call.isCaller || acceptingCall) return;
    acceptingCall = true;
    acceptButton.disabled = true;
    let stream;
    try {
      const callSnapshot = await getDoc(doc(db, "calls", call.id));
      if (!callSnapshot.exists() || callSnapshot.data().status === "ended") {
        throw new Error("This call has already ended.");
      }
      const details = callSnapshot.data();
      await refreshRtcConfiguration();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: details.type === "video"
      });
      incomingCallIds.add(call.id);
      await enterCall(call.id, details, stream, false);
    } catch (callError) {
      if (stream && call?.localStream !== stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      showError(callError.message || "Could not join the call. Check camera and microphone permissions.");
    } finally {
      acceptingCall = false;
      acceptButton.disabled = false;
    }
  }

  async function declineIncomingCall() {
    if (!call || call.isCaller) return;
    const callId = call.id;
    incomingCallIds.add(callId);
    try {
      await setDoc(doc(db, "calls", callId, "participants", user.uid), {
        uid: user.uid,
        state: "declined",
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (declineError) {
      showError(declineError.message || "Could not decline the call.");
      return;
    }
    clearCallState();
  }

  function clearCallState() {
    if (!call) return;
    call.participantsUnsubscribe?.();
    call.callUnsubscribe?.();
    for (const unsubscribe of call.connectionUnsubscribes) unsubscribe();
    for (const observer of call.peerObservers.values()) {
      if (typeof observer === "function") observer();
    }
    for (const peerConnection of call.peerConnections.values()) peerConnection.close();
    for (const track of call.localStream?.getTracks() || []) track.stop();
    media.replaceChildren();
    const callId = call.id;
    call = null;
    incomingCallIds.add(callId);
    if (dialog.open) dialog.close();
  }

  async function finishCall(updateCall = true) {
    if (!call) return;
    const activeCall = call;
    let updateError = null;
    try {
      if (updateCall) {
        if (activeCall.isCaller) {
          await updateDoc(doc(db, "calls", activeCall.id), {
            status: "ended",
            endedAt: serverTimestamp()
          });
        } else {
          await updateDoc(doc(db, "calls", activeCall.id, "participants", user.uid), {
            state: "left",
            leftAt: serverTimestamp()
          });
        }
      }
    } catch (callError) {
      updateError = callError;
    } finally {
      clearCallState();
    }
    if (updateError) {
      showError(updateError.message || "Could not update the call status.");
    }
  }

  function watchCalls() {
    callsUnsubscribe?.();
    callsUnsubscribe = null;
    if (!user) return;

    const callsQuery = query(
      collection(db, "calls"),
      where("participantIds", "array-contains", user.uid)
    );
    callsUnsubscribe = onSnapshot(callsQuery, snapshot => {
      if (call) return;
      for (const callDoc of snapshot.docs) {
        const details = callDoc.data();
        if (
          details.callerId === user.uid ||
          !["active", "ringing"].includes(details.status) ||
          incomingCallIds.has(callDoc.id)
        ) continue;
        call = {
          id: callDoc.id,
          type: details.type,
          title: details.title || "TapChat call",
          participantIds: details.participantIds,
          participantNames: details.participantNames || {},
          isCaller: false
        };
        setDialogContent({
          callTitle: call.title,
          callStatus: `${call.participantNames?.[details.callerId] || "Someone"} is calling`,
          incoming: true,
          type: call.type
        });
        dialog.showModal();
        break;
      }
    }, showError);
  }

  dialog.querySelector(".tapchat-call-close").addEventListener("click", () => {
    if (call?.isCaller || call?.localStream) finishCall();
    else if (call) declineIncomingCall();
    else dialog.close();
  });
  dialog.querySelector(".tapchat-call-accept").addEventListener("click", acceptIncomingCall);
  dialog.querySelector(".tapchat-call-decline").addEventListener("click", declineIncomingCall);
  dialog.querySelector(".tapchat-call-end").addEventListener("click", () => finishCall());
  muteButton.addEventListener("click", () => {
    const track = call?.localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    muteButton.textContent = track.enabled ? "Mute microphone" : "Unmute microphone";
  });
  cameraButton.addEventListener("click", () => {
    const track = call?.localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    cameraButton.textContent = track.enabled ? "Turn camera off" : "Turn camera on";
  });
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    if (call?.isCaller || call?.localStream) finishCall();
    else if (call) declineIncomingCall();
  });

  return {
    setUser(nextUser) {
      if (call && user?.uid !== nextUser?.uid) {
        if (call.localStream) finishCall();
        else clearCallState();
      }
      user = nextUser;
      watchCalls();
    },
    startCall,
    close() {
      callsUnsubscribe?.();
      if (call) finishCall();
    }
  };
}
