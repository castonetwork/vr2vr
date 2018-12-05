import "babel-polyfill";
const JanusServer = require("./JanusServer");

const domReady = new Promise((resolve, reject) => {
  console.log("DOM ready");
  resolve();
});

const makeJanusServer = async ws => {
  let intervalIdsOnWs = [];
  let janusServer = await new Promise((resolve, reject) => {
    ws.onerror = console.error;
    ws.onclose = () => {
      console.log("CONNECTION CLOSED!");
      intervalIdsOnWs.map(clearInterval);
    };

    ws.onopen = () => {
      //setSendStream
      let janusServer = JanusServer(ws);
      janusServer.intervalIdsOnWs = intervalIdsOnWs;
      console.log("success setting websocket");
      resolve(janusServer);
    };
  });
  return janusServer;
};

const getNodeInput = async janusServer => {
  //init ws
  let nodeInput = {};
  nodeInput.sessionId = await janusServer._createSession();
  nodeInput.handleId = await janusServer._attach(nodeInput.sessionId);
  janusServer.intervalIdsOnWs.push(
    setInterval(x => {
      janusServer._startKeepAlive(nodeInput.sessionId, nodeInput.handleId);
    }, 30000)
  );

  nodeInput.roomId = await janusServer.createRoom(
    nodeInput.sessionId,
    nodeInput.handleId
  );
  nodeInput.type = "publisher";
  let joinedInfo = await janusServer._join(nodeInput);
  nodeInput.broadcastId = joinedInfo.plugindata.data.id;
  return { ...nodeInput, janusServer };
};

const getNodeOutput = async nodeInput => {
  let nodeOutput = {};
  nodeOutput.sessionId = nodeInput.sessionId;
  nodeOutput.handleId = await nodeInput.janusServer._attach(
    nodeInput.sessionId
  );
  nodeInput.janusServer.intervalIdsOnWs.push(
    setInterval(x => {
      nodeInput.janusServer._startKeepAlive(
        nodeOutput.sessionId,
        nodeOutput.handleId
      );
    }, 30000)
  );

  return { ...nodeOutput, janusServer: nodeInput.janusServer };
};

//const getPcForPublish
const inputStreamToMs = async nodeInput => {
  let janusServer = nodeInput.janusServer;
  let pc = new RTCPeerConnection(null);
  // send any ice candidates to the other peer
  pc.onicecandidate = event => {
    console.log("[ICE]", event);
    if (event.candidate) {
      janusServer.addIceCandidate(event.candidate, nodeInput);
    }
  };
  pc.oniceconnectionstatechange = function(e) {
    console.log("[ICE STATUS] ", pc.iceConnectionState);
  };

  // let the "negotiationneeded" event trigger offer generation
  pc.onnegotiationneeded = async () => {};

  try {
    // get a local stream, show it in a self-view and add it to be sent
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    let sdp = await pc.createOffer();
    await pc.setLocalDescription(sdp);
    nodeInput.jsep = sdp;

    let answerSDP = await janusServer._configure(nodeInput);
    await pc.setRemoteDescription(answerSDP.jsep);

    document.getElementById("studio").srcObject = stream;
  } catch (err) {
    console.error(err);
  }
};
const relayNode = async (originNodeInput, relayNodeInput) => {
  let originNodeOutput = await getNodeOutput(originNodeInput);

  let originOfferSDP = await originNodeOutput.janusServer._join({
    sessionId: originNodeOutput.sessionId,
    handleId: originNodeOutput.handleId,
    roomId: originNodeInput.roomId,
    broadcastId: originNodeInput.broadcastId,
    type: "subscriber"
  });
  originOfferSDP.jsep.trickle = false;
  let releyAnswerSDP = await relayNodeInput.janusServer._configure({
    sessionId: relayNodeInput.sessionId,
    handleId: relayNodeInput.handleId,
    roomId: relayNodeInput.roomId,
    jsep: originOfferSDP.jsep
  });
  releyAnswerSDP.jsep.trickle = false;
  await originNodeOutput.janusServer._start({
    sessionId: originNodeOutput.sessionId,
    handleId: originNodeOutput.handleId,
    roomId: originNodeInput.roomId,
    jsep: releyAnswerSDP.jsep
  });
};

const assignStreamToVideoEle = async (nodeInput, eleId) => {
  let nodeOutput = await getNodeOutput(nodeInput);

  let pc = new RTCPeerConnection(null);

  pc.onicecandidate = event => {
    console.log("[ICE]", event);
    if (event.candidate) {
      nodeOutput.janusServer.addIceCandidate(event.candidate, {
        sessionId: nodeOutput.sessionId,
        handleId: nodeOutput.handleId
      });
    }
  };

  pc.oniceconnectionstatechange = function(e) {
    console.log("[ICE STATUS_VIEWER] ", pc.iceConnectionState);
  };
  // let the "negotiationneeded" event trigger offer generation
  pc.ontrack = async event => {
    console.log("[ON TRACK_VIEWER]", event);
    //event.streams.forEach(track => pc.addTrack(track, stream));
    document.getElementById(eleId).srcObject = event.streams[0];
  };

  try {
    let nodeInputOfferSDP = await nodeOutput.janusServer._join({
      sessionId: nodeOutput.sessionId,
      handleId: nodeOutput.handleId,
      roomId: nodeInput.roomId,
      broadcastId: nodeInput.broadcastId,
      type: "subscriber"
    });
    await pc.setRemoteDescription(nodeInputOfferSDP.jsep);
    let answerSDP = await pc.createAnswer();
    await pc.setLocalDescription(answerSDP);
    await nodeOutput.janusServer._start({
      sessionId: nodeOutput.sessionId,
      handleId: nodeOutput.handleId,
      roomId: nodeInput.roomId,
      jsep: answerSDP
    });
  } catch (err) {
    console.error(err);
  }
};

const initApp = async () => {
  console.log("init app");
  domReady
    .then(async () => {
      document.getElementById("btnReady").classList.remove("connecting");
      document.getElementById("btnReady").classList.remove("button-outline");

      let jw1 = new WebSocket("ws://127.0.0.1:8188", "janus-protocol");
      let janusServer1 = await makeJanusServer(jw1);
      let node1 = await getNodeInput(janusServer1);

      //
      let jw2 = new WebSocket("ws://127.0.0.1:8189", "janus-protocol");
      let janusServer2 = await makeJanusServer(jw2);
      let node2 = await getNodeInput(janusServer2);

      //let jw3 = new WebSocket("ws://13.209.96.83:8188", "janus-protocol");
      let jw3 = new WebSocket("ws://127.0.0.1:8188", "janus-protocol");
      let janusServer3 = await makeJanusServer(jw3);
      let node3 = await getNodeInput(janusServer3);

      await inputStreamToMs(node1);
      await relayNode(node1, node2);
      await relayNode(node1, node3);
      await assignStreamToVideoEle(node2, "viewer1");
      await assignStreamToVideoEle(node3, "viewer2");
    })
    .catch(console.error);
};
initApp();
