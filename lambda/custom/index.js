/* eslint-disable  func-names */
/* eslint-disable  no-console */

const Alexa = require("ask-sdk");
const AWS = require("aws-sdk");
const RADIO_DBNAME = "MyRadios";
const documentClient = new AWS.DynamoDB.DocumentClient();
const PAGE_SIZE = 5;
let constants = require("./constants");

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "LaunchRequest";
  },
  async handle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    let message;
    let reprompt;
    if (!playbackInfo.hasPreviousPlaybackSession) {
      message =
        "Welcome to the My Radios. Say play followed by the radio station name such as play ABC News, or say 'Help' for more options.";
      reprompt =
        "You can say, play followed by the radio station name such as play ABC News or say 'Help' for more options.";
    } else {
      playbackInfo.inPlaybackSession = false;
      const foundRadio =
        constants.audioData.find(radio => radio.id === playbackInfo.index) ||
        constants.audioData[0];
      message = `You were listening to ${
        foundRadio.title
      }. Would you like to resume?`;
      reprompt = "You can say yes to resume, or no to stop";
    }

    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(reprompt)
      .getResponse();
  }
};

const AudioPlayerEventHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type.startsWith("AudioPlayer.");
  },
  async handle(handlerInput) {
    const {
      requestEnvelope,
      attributesManager,
      responseBuilder
    } = handlerInput;
    const audioPlayerEventName = requestEnvelope.request.type.split(".")[1];
    const {
      playbackSetting,
      playbackInfo
    } = await attributesManager.getPersistentAttributes();

    switch (audioPlayerEventName) {
      case "PlaybackStarted":
        playbackInfo.token = getToken(handlerInput);
        playbackInfo.index = await getIndex(handlerInput);
        playbackInfo.inPlaybackSession = true;
        playbackInfo.hasPreviousPlaybackSession = true;
        break;
      case "PlaybackFinished":
        playbackInfo.inPlaybackSession = false;
        playbackInfo.hasPreviousPlaybackSession = false;
        playbackInfo.nextStreamEnqueued = false;
        break;
      case "PlaybackStopped":
        playbackInfo.token = getToken(handlerInput);
        playbackInfo.index = await getIndex(handlerInput);
        playbackInfo.offsetInMilliseconds = getOffsetInMilliseconds(
          handlerInput
        );
        break;
      case "PlaybackFailed":
        playbackInfo.inPlaybackSession = false;
        console.log(
          "Playback Failed : %j",
          handlerInput.requestEnvelope.request.error
        );
        return;
      default:
        throw new Error("Should never reach here!");
    }

    return responseBuilder.getResponse();
  }
};

const CheckAudioInterfaceHandler = {
  async canHandle(handlerInput) {
    const audioPlayerInterface = (
      (((handlerInput.requestEnvelope.context || {}).System || {}).device || {})
        .supportedInterfaces || {}
    ).AudioPlayer;
    return audioPlayerInterface === undefined;
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("Sorry, this skill is not supported on this device")
      .withShouldEndSession(true)
      .getResponse();
  }
};

const StartPlaybackHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    if (!playbackInfo.inPlaybackSession) {
      return (
        request.type === "IntentRequest" && request.intent.name === "PlayAudio"
      );
    }
    if (request.type === "PlaybackController.PlayCommandIssued") {
      return true;
    }

    if (request.type === "IntentRequest") {
      return (
        request.intent.name === "PlayAudio" ||
        request.intent.name === "AMAZON.ResumeIntent"
      );
    }
  },
  handle(handlerInput) {
    return controller.play(handlerInput);
  }
};

const NextPlaybackHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      (request.type === "PlaybackController.NextCommandIssued" ||
        (request.type === "IntentRequest" &&
          request.intent.name === "AMAZON.NextIntent"))
    );
  },
  handle(handlerInput) {
    return controller.playNext(handlerInput);
  }
};

const PreviousPlaybackHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      (request.type === "PlaybackController.PreviousCommandIssued" ||
        (request.type === "IntentRequest" &&
          request.intent.name === "AMAZON.PreviousIntent"))
    );
  },
  handle(handlerInput) {
    return controller.playPrevious(handlerInput);
  }
};

const PausePlaybackHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      (request.intent.name === "AMAZON.StopIntent" ||
        request.intent.name === "AMAZON.CancelIntent" ||
        request.intent.name === "AMAZON.PauseIntent")
    );
  },
  handle(handlerInput) {
    return controller.stop(handlerInput);
  }
};

const YesHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      !playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.YesIntent"
    );
  },
  handle(handleInput) {
    return controller.play(handleInput);
  }
};

const NoHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      !playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.NoIntent"
    );
  },
  async handle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);

    playbackInfo.index = 1;
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;
    playbackInfo.hasPreviousPlaybackSession = false;

    return HelpHandler.handle(handlerInput);
  }
};

const HelpHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === "IntentRequest" &&
      handlerInput.requestEnvelope.request.intent.name === "AMAZON.HelpIntent"
    );
  },
  async handle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    let message;

    if (!playbackInfo.hasPreviousPlaybackSession) {
      message =
        "You can also ask 'what are the stations', to get all stations or to play a station from given name, such as 'play the ABC News'.";
    } else if (!playbackInfo.inPlaybackSession) {
      message = `You were listening to ${
        constants.audioData[playbackInfo.index].title
      }. Would you like to resume?`;
    } else {
      message =
        "You are listening to My Radios. You can say, Next or Previous to navigate through the radio stations. At any time, you can say Pause to pause the audio and Resume to resume.";
    }

    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(message)
      .getResponse();
  }
};

const ExitHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      !playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      (request.intent.name === "AMAZON.StopIntent" ||
        request.intent.name === "AMAZON.CancelIntent")
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak("Goodbye!").getResponse();
  }
};

const SystemExceptionHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type ===
      "System.ExceptionEncountered"
    );
  },
  handle(handlerInput) {
    console.log(
      `System exception encountered: ${
        handlerInput.requestEnvelope.request.reason
      }`
    );
  }
};

const LoadMoreStationsHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return (
      request.type === "IntentRequest" &&
      request.intent.name === "LoadMoreStations"
    );
  },
  handle(handlerInput) {
    let message = "";
    let { page = 0 } = handlerInput.attributesManager.getSessionAttributes();
    if (page === 0) {
      return StationListHandler.handle(handlerInput);
    } else {
      let nextPage = page + 1;
      var stations_page = constants.audioData.slice(
        page * PAGE_SIZE,
        nextPage * PAGE_SIZE
      );

      if (stations_page.length <= 0) {
        message =
          "Play a station from given name, such as 'play the ABC News'.";
      } else {
        stations_page.map(station => {
          message = `${message}, ${station.title}`;
        });
        message = `${message}, Play a station from given name, or say 'more', to load more stations.`;
      }
      handlerInput.attributesManager.setSessionAttributes({ page: nextPage });
    }

    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(message)
      .getResponse();
  }
};

const StationListHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;

    return (
      request.type === "IntentRequest" &&
      request.intent.name === "RadioStations"
    );
  },
  async handle(handlerInput) {
    let message = "The stations are: ";
    var stations_page_1 = constants.audioData.slice(0, PAGE_SIZE);

    stations_page_1.map(station => {
      message = `${message}, ${station.title}`;
    });
    message = `${message}, Play a station by name ,or say 'more' for more stations.`;
    handlerInput.attributesManager.setSessionAttributes({ page: 1 });
    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(message)
      .getResponse();
  }
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    const message =
      "Sorry, this is not a valid command. Please say help to hear what you can say.";

    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(message)
      .getResponse();
  }
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "SessionEndedRequest";
  },
  handle(handlerInput) {
    console.log(
      `Session ended with reason: ${
        handlerInput.requestEnvelope.request.reason
      }`
    );

    return handlerInput.responseBuilder.getResponse();
  }
};

/* INTERCEPTORS */

const LoadPersistentAttributesRequestInterceptor = {
  async process(handlerInput) {
    const persistentAttributes = await handlerInput.attributesManager.getPersistentAttributes();
    const radios = await getRadios();
    if (radios && radios.Items && radios.Items.length > 0) {
      constants.audioData = [...radios.Items];
    }
    // Check if user is invoking the skill the first time and initialize preset values
    if (Object.keys(persistentAttributes).length === 0) {
      handlerInput.attributesManager.setPersistentAttributes({
        playbackSetting: {},
        playbackInfo: {
          playOrder: [],
          index: 1,
          offsetInMilliseconds: 0,
          playbackIndexChanged: true,
          token: "iamtoken",
          nextStreamEnqueued: false,
          inPlaybackSession: false,
          hasPreviousPlaybackSession: false
        }
      });
    }
  }
};

const SavePersistentAttributesResponseInterceptor = {
  async process(handlerInput) {
    await handlerInput.attributesManager.savePersistentAttributes();
  }
};

const CanFulfillIntentRequestHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === "CanFulfillIntentRequest";
  },
  handle(handlerInput) {
    const canFulfillIntent = {
      canFulfill: "YES",
      slots: {
        STATION: {
          canUnderstand: "YES",
          canFulfill: "YES"
        }
      }
    };
    return handlerInput.responseBuilder
      .withCanFulfillIntent(canFulfillIntent)
      .getResponse();
  }
};

/* HELPER FUNCTIONS */

async function getPlaybackInfo(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes();
  return attributes.playbackInfo;
}

async function canThrowCard(handlerInput) {
  const { requestEnvelope, attributesManager } = handlerInput;
  const playbackInfo = await getPlaybackInfo(handlerInput);

  if (
    requestEnvelope.request.type === "IntentRequest" &&
    playbackInfo.playbackIndexChanged
  ) {
    playbackInfo.playbackIndexChanged = false;
    return true;
  }
  return false;
}

const controller = {
  async play(handlerInput) {
    const { attributesManager, responseBuilder } = handlerInput;
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const { token, offsetInMilliseconds, index } = playbackInfo;
    const playBehavior = "REPLACE_ALL";
    let podcast = null;
    playbackInfo.nextStreamEnqueued = false;

    const station =
      handlerInput.requestEnvelope &&
      handlerInput.requestEnvelope.request &&
      handlerInput.requestEnvelope.request.intent &&
      handlerInput.requestEnvelope.request.intent.slots &&
      handlerInput.requestEnvelope.request.intent.slots.STATION;

    if (station && station.value) {
      let match_station = station.value;
      if (
        station.resolutions &&
        station.resolutions.resolutionsPerAuthority &&
        station.resolutions.resolutionsPerAuthority.length > 0
      ) {
        match_station =
          station.resolutions.resolutionsPerAuthority[0].values[0].value.name;
      }

      const found = constants.audioData.find(radio => {
        return radio.title === match_station;
      });

      if (found) {
        playbackInfo.index = found.id;
        playbackInfo.offsetInMilliseconds = 0;
        playbackInfo.playbackIndexChanged = true;
        podcast = found;
      }
    } else {
      podcast = constants.audioData.find(radio => {
        return radio.id === index;
      });
    }

    responseBuilder
      .speak(`Playing ${podcast.title}`)
      .withShouldEndSession(true)
      .addAudioPlayerPlayDirective(
        playBehavior,
        podcast.url,
        token,
        offsetInMilliseconds,
        null
      );

    if (await canThrowCard(handlerInput)) {
      const cardTitle = `Playing ${podcast.title}`;
      const cardContent = `Playing ${podcast.title}`;
      responseBuilder.withSimpleCard(cardTitle, cardContent);
    }

    return responseBuilder.getResponse();
  },

  stop(handlerInput) {
    return handlerInput.responseBuilder
      .addAudioPlayerStopDirective()
      .getResponse();
  },
  async playNext(handlerInput) {
    const {
      playbackInfo,
      playbackSetting
    } = await handlerInput.attributesManager.getPersistentAttributes();

    const nextIndex = playbackInfo.index % constants.audioData.length;

    if (nextIndex === 0) {
      return handlerInput.responseBuilder
        .speak("You have reached the end of the playlist")
        .addAudioPlayerStopDirective()
        .getResponse();
    }

    playbackInfo.index = nextIndex;
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;

    return this.play(handlerInput);
  },
  async playPrevious(handlerInput) {
    const {
      playbackInfo,
      playbackSetting
    } = await handlerInput.attributesManager.getPersistentAttributes();

    let previousIndex = playbackInfo.index - 1;

    if (previousIndex <= 1) {
      return handlerInput.responseBuilder
        .speak("You have reached the start of the station list")
        .addAudioPlayerStopDirective()
        .getResponse();
    }

    playbackInfo.index = previousIndex;
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;

    return this.play(handlerInput);
  }
};

function getToken(handlerInput) {
  return handlerInput.requestEnvelope.request.token;
}

function getRadios() {
  const params = {
    TableName: RADIO_DBNAME,
    FilterExpression: "isActive = :isActive",
    ExpressionAttributeValues: { ":isActive": 1 },
    Limit: 1000
  };

  return documentClient.scan(params).promise();
}

async function getIndex(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes();

  return attributes.playbackInfo.index || 1;
}

function getOffsetInMilliseconds(handlerInput) {
  return handlerInput.requestEnvelope.request.offsetInMilliseconds;
}

const skillBuilder = Alexa.SkillBuilders.standard();
exports.handler = skillBuilder
  .addRequestHandlers(
    CheckAudioInterfaceHandler,
    LaunchRequestHandler,
    HelpHandler,
    SystemExceptionHandler,
    SessionEndedRequestHandler,
    YesHandler,
    NoHandler,
    StationListHandler,
    LoadMoreStationsHandler,
    StartPlaybackHandler,
    NextPlaybackHandler,
    PreviousPlaybackHandler,
    PausePlaybackHandler,
    ExitHandler,
    AudioPlayerEventHandler,
    CanFulfillIntentRequestHandler
  )
  .addRequestInterceptors(LoadPersistentAttributesRequestInterceptor)
  .addResponseInterceptors(SavePersistentAttributesResponseInterceptor)
  .addErrorHandlers(ErrorHandler)
  .withAutoCreateTable(false)
  .withTableName(constants.skill.dynamoDBTableName)
  .lambda();
