/**
    Copyright 2014-2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.

    Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at

        http://aws.amazon.com/apache2.0/

    or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

/**
 * This sample shows how to create a Lambda function for handling Alexa Skill requests that:
 * - Web service: communicate with an external web service to get tide data from NOAA CO-OPS API (http://tidesandcurrents.noaa.gov/api/)
 * - Multiple optional slots: has 2 slots (city and date), where the user can provide 0, 1, or 2 values, and assumes defaults for the unprovided values
 * - DATE slot: demonstrates date handling and formatted date responses appropriate for speech
 * - LITERAL slot: demonstrates literal handling for a finite set of known values
 * - Dialog and Session state: Handles two models, both a one-shot ask and tell model, and a multi-turn dialog model.
 *   If the user provides an incorrect slot in a one-shot model, it will direct to the dialog model. See the
 *   examples section for sample interactions of these models.
 * Examples:
 * One-shot model:
 *  User:  "Alexa, ask Tide Pooler when is the high tide in Seattle on Saturday"
 *  Alexa: "Saturday June 20th in Seattle the first high tide will be around 7:18 am,
 *          and will peak at ...""
 * Dialog model:
 *  User:  "Alexa, open Tide Pooler"
 *  Alexa: "Welcome to Tide Pooler. Which city would you like tide information for?"
 *  User:  "Seattle"
 *  Alexa: "For which date?"
 *  User:  "this Saturday"
 *  Alexa: "Saturday June 20th in Seattle the first high tide will be around 7:18 am,
 *          and will peak at ...""
 */

/**
 * App ID for the skill
 */
var APP_ID = undefined; //replace with "amzn1.echo-sdk-ams.app.[your-unique-value-here]";

var http = require('http'),
    alexaDateUtil = require('./alexaDateUtil');

/**
 * The AlexaSkill prototype and helper functions
 */
var AlexaSkill = require('./AlexaSkill');

/**
 * MODecide is a child of AlexaSkill.
 * To read more about inheritance in JavaScript, see the link below.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Introduction_to_Object-Oriented_JavaScript#Inheritance
 */
var MODecide = function () {
    AlexaSkill.call(this, APP_ID);
};

// Extend AlexaSkill
MODecide.prototype = Object.create(AlexaSkill.prototype);
MODecide.prototype.constructor = MODecide;

// ----------------------- Override AlexaSkill request and intent handlers -----------------------

MODecide.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
    console.log("onSessionStarted requestId: " + sessionStartedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any initialization logic goes here
};

MODecide.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
    console.log("onLaunch requestId: " + launchRequest.requestId + ", sessionId: " + session.sessionId);
    handleWelcomeRequest(response);
};

MODecide.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
    console.log("onSessionEnded requestId: " + sessionEndedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any cleanup logic goes here
};

/**
 * override intentHandlers to map intent handling functions.
 */
MODecide.prototype.intentHandlers = {
    OneShotUmbrellaIntent: function (intent, session, response) {
        console.log('OneShotUmbrellaIntent');
        handleOneshotUmbrellaRequest(intent, session, response);
    },

    DialogUmbrellaIntent: function (intent, session, response) {
        // Determine if this turn is for city, for date, or an error.
        // We could be passed slots with values, no slots, slots with no value.
        var citySlot = intent.slots.City;
        var dateSlot = intent.slots.Date;
        if (citySlot && citySlot.value) {
            handleCityDialogRequest(intent, session, response);
        } else if (dateSlot && dateSlot.value) {
            handleDateDialogRequest(intent, session, response);
        } else {
            handleNoSlotDialogRequest(intent, session, response);
        }
    },

    SupportedCitiesIntent: function (intent, session, response) {
        handleSupportedCitiesRequest(intent, session, response);
    },

    HelpIntent: function (intent, session, response) {
        handleHelpRequest(response);
    }
};

// -------------------------- MODecide Domain Specific Business Logic --------------------------

function handleWelcomeRequest(response) {
    var inputPrompt = "How can we help you?";
    var speechOutput = "Welcome to The Met Office. " + whichCityPrompt;
    var repromptText = "We can help you make decisions based on our  "
        + "world leading weather forecasts. "
        + "For instance, you can find out if you'll need an umbrella."
        + inputPromt;

    response.ask(speechOutput, repromptText);
}

function handleHelpRequest(response) {
    var repromptText = "Ask me if you are going to need an umbrella if you like.";
    var speechOutput = "I'm here to help you make decisions that rely on our "
        + "world leading weather forecasts."
        + "Or you can say exit. "
        + "For instance, you can find out if you'll need an umbrella."
        + repromptText;

    response.ask(speechOutput, repromptText);
}

/**
 * Handles the dialog step where the user provides a city
 */
function handleCityDialogRequest(intent, session, response) {

    var cityStation = getLocationFromIntent(intent, false);
    if (cityStation.error) {
        var repromptText = "Currently, I know tide information for these west coast cities: " + getAllStationsText()
            + "Which city would you like tide information for?";
        // if we received a value for the incorrect city, repeat it to the user, otherwise we received an empty slot
        var speechOutput = cityStation.city ? "I'm sorry, I don't have any data for " + cityStation.city + ". " + repromptText : repromptText;
        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a date yet, go to date. If we have a date, we perform the final request
    if (session.attributes.date) {
        getFinalTideResponse(cityStation, session.attributes.date, response);
    } else {
        // set city in session and prompt for date
        session.attributes.city = cityStation;
        var speechOutput = "For which date?";
        var repromptText = "For which date would you like tide information for " + cityStation.city + "?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handles the dialog step where the user provides a date
 */
function handleDateDialogRequest(intent, session, response) {

    var date = getDateFromIntent(intent);
    if (!date) {
        var repromptText = "Please try again saying a day of the week, for example, Saturday. "
            + "For which date would you like tide information?";
        var speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a city yet, go to city. If we have a city, we perform the final request
    if (session.attributes.city) {
        getFinalTideResponse(session.attributes.city, date, response);
    } else {
        // The user provided a date out of turn. Set date in session and prompt for city
        session.attributes.date = date;
        var speechOutput = "For which city would you like tide information for " + date.displayDate + "?";
        var repromptText = "For which city?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handle no slots, or slot(s) with no values.
 * In the case of a dialog based skill with multiple slots,
 * when passed a slot with no value, we cannot have confidence
 * it is the correct slot type so we rely on session state to
 * determine the next turn in the dialog, and reprompt.
 */
function handleNoSlotDialogRequest(intent, session, response) {
    if (session.attributes.city) {
        // get date re-prompt
        var repromptText = "Please try again saying a day of the week, for example, Saturday. ";
        var speechOutput = repromptText;

        response.ask(speechOutput, repromptText);
    } else {
        // get city re-prompt
        handleSupportedCitiesRequest(intent, session, response);
    }
}

/**
 * This handles the one-shot interaction, where the user utters a phrase like:
 * 'Alexa, open Tide Pooler and get tide information for Seattle on Saturday'.
 * If there is an error in a slot, this will guide the user to the dialog approach.
 */
function handleOneshotUmbrellaRequest(intent, session, response) {

    // Determine city, using default if none provided
    var location = getLocationFromIntent(intent, true);
    if (location.error) {
        // invalid city. move to the dialog
        var repromptText = "Currently, I can only help you with cities in the UK"
                         + "Which city would you like tide information for?";
        // if we received a value for the incorrect city, repeat it to the user, otherwise we received an empty slot
        var speechOutput = location.city ? "I'm sorry, I don't have any data for " + location.city + ". " + repromptText : repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // // Determine custom date
    // var date = getDateFromIntent(intent);
    // if (!date) {
    //     // Invalid date. set city in session and prompt for date
    //     session.attributes.city = location;
    //     var repromptText = "Please try again saying a day of the week, for example, Saturday. "
    //         + "For which date would you like tide information?";
    //     var speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

    //     response.ask(speechOutput, repromptText);
    //     return;
    // }

    // all slots filled, either from the user or by default values. Move to final request
    date = new Date();
    getFinalUmbrellaResponse(location, date, response);
}

function getUmbrellaDecisionResponse(rainProb) {
    var decisionTxt = "";
    if (rainProb > 0.5) {
        decisionTxt = "Take an umbrella";
    } else {
        decisionTxt = "Don't take an umbrella";
    }

    return decisionTxt;
}

/**
 * Both the one-shot and dialog based paths lead to this method to issue the request, and
 * respond to the user with the final answer.
 */
function getFinalUmbrellaResponse(location, date, response) {

    // Issue the request, and respond to the user
    makeDataPointRequest(location, date, function dataPointCallback(err, dataPointResponse) {
        var speechOutput;

        if (err) {
            speechOutput = "Sorry, the Met Office Data Point is experiencing a problem. Please try again later";
        } else {
            speechOutput = getUmbrellaDecisionResponse(dataPointResponse.rainProb);
        }

        response.tellWithCard(speechOutput, "MODecide", speechOutput)
    });
}

/**
 * Uses NOAA.gov API, documented: http://tidesandcurrents.noaa.gov/api/
 * Results can be verified at: http://tidesandcurrents.noaa.gov/noaatidepredictions/NOAATidesFacade.jsp?Stationid=[id]
 */
function makeDataPointRequest(station, date, callback) {
    /* data point stuff */
}

/**
 * Gets the city from the intent, or returns an error
 */
function getLocationFromIntent(intent, assignDefault) {

    var locationSlot = intent.slots.location;
    // slots can be missing, or slots can be provided but with empty value.
    // must test for both.
    if (!locationSlot || !locationSlot.value) {
       /* if missing */
    } else {
        // lookup the city. Sample skill uses well known mapping of a few known cities to station id.
        return locationSlot.value;
    }
}

/**
 * Gets the date from the intent, defaulting to today if none provided,
 * or returns an error
 */
function getDateFromIntent(intent) {

    var dateSlot = intent.slots.Date;
    // slots can be missing, or slots can be provided but with empty value.
    // must test for both.
    if (!dateSlot || !dateSlot.value) {
        // default to today
        return {
            displayDate: "Today",
            requestDateParam: "date=today"
        }
    } else {

        var date = new Date(dateSlot.value);

        // format the request date like YYYYMMDD
        var month = (date.getMonth() + 1);
        month = month < 10 ? '0' + month : month;
        var dayOfMonth = date.getDate();
        dayOfMonth = dayOfMonth < 10 ? '0' + dayOfMonth : dayOfMonth;
        var requestDay = "begin_date=" + date.getFullYear() + month + dayOfMonth
            + "&range=24";

        return {
            displayDate: alexaDateUtil.getFormattedDate(date),
            requestDateParam: requestDay
        }
    }
}

// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
    var moDecide = new MODecide();
    moDecide.execute(event, context);
};
