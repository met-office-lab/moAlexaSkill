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
    alexaDateUtil = require('./alexaDateUtil'),
    datapoint = require("datapoint-js"),
    request = require("request");

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
 * This handles the one-shot interaction, where the user utters a phrase like:
 * 'Alexa, open Tide Pooler and get tide information for Seattle on Saturday'.
 * If there is an error in a slot, this will guide the user to the dialog approach.
 */
function handleOneshotUmbrellaRequest(intent, session, response) {
    // Determine city, using default if none provided
    var responseTxt = getLocationFromIntent(intent, 
                                            function(location) {
                                                onGotLocation(location, response);
                                            });
}

function onGotLocation(location, response) {
    var rainprob = getWeatherFromLocation(location);
    var responseTxt = getUmbrellaDecisionResponse(rainprob);
    response.tellWithCard(responseTxt, "Do you need an umbrella?", responseTxt)
    console.log(responseTxt);
}

/**
 * Gets the city from the intent, or returns an error
 */
function getLocationFromIntent(intent, callback) {
    var city = intent.slots.location.value;
    request("http://nominatim.openstreetmap.org/search?q=+"+city+"&format=json&polygon=0&addressdetails=1", 
            function(error, response, body) {
                if (!error && response.statusCode == 200) {
                    var r = JSON.parse(body)[0];
                    console.log(city);
                    callback({
                        "lat": r.lat,
                        "lon": r.lon,
                        "City": city
                    })
                }
                else {
                    throw error;
                }
            })
}

function getWeatherFromLocation(location){
    datapoint.set_key("41bf616e-7dbc-4066-826a-7270b8da4b93");
    var site = datapoint.get_nearest_site(location.lon, location.lat);
    var forecast = datapoint.get_forecast_for_site(site.id);
    var current_timestep = forecast.days[0].timesteps[0];
    
    return current_timestep.precipitation.value;
}

function getUmbrellaDecisionResponse( rainProb ) {
    var decisionTxt = "";
    console.log(rainProb);
    if (rainProb > 50) {
        decisionTxt = "Take an umbrella";
    } else {
        decisionTxt = "Don't take an umbrella";
    }

    return decisionTxt;
}


// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
    var moDecide = new MODecide();
    moDecide.execute(event, context);
};
