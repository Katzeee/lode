export type Peer = {
  owningActorId: string;
  peerEncPub: Uint8Array;
  epoch: number;
  wrappedTransit: Uint8Array;
  peerName: string;
};

export type MembershipState = {
  owner: string;
  peers: Map<string, Peer>;
  currentEpoch: number;
};

export type PeerPublicKeys = {
  peerId: string;
  owningActorId: string;
  peerEncPub: Uint8Array;
  peerName: string;
};

export type PeerWrap = PeerPublicKeys & {
  wrappedTransit: Uint8Array;
};

export type MembershipBody =
  | {
      case: "root";
      value: {
        owner: string;
        ownerPeerEncPub: Uint8Array;
        ownerPeerId: string;
        wrappedTransit: Uint8Array;
        epoch: number;
        peerName: string;
      };
    }
  | {
      case: "add";
      value: {
        owningActor: string;
        peerEncPub: Uint8Array;
        peerId: string;
        wrappedTransit: Uint8Array;
        epoch: number;
        peerName: string;
      };
    }
  | {
      case: "rotate";
      value: {
        epoch: number;
        wrapped: PeerWrap[];
        encPrev: Uint8Array;
      };
    }
  | { case: "transfer"; value: { newOwner: string } }
  | { case: undefined; value?: undefined };

export type MembershipRecord = {
  readonly signer: string;
  readonly sig: Uint8Array;
  readonly body: MembershipBody;
  readonly signedBytes: Uint8Array;
};
