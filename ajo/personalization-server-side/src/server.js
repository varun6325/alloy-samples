/*
Copyright 2022 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/
const path = require("path");

require("dotenv").config({ path: path.resolve(process.cwd(), "..", ".env") });

const express = require("express");
const cookieParser = require("cookie-parser");

const {
  createAepEdgeClient,
  createIdentityPayload,
} = require("aep-edge-samples-common/aepEdgeClient");

const {
  loadHandlebarsTemplate,
} = require("aep-edge-samples-common/templating");

const { isString } = require("@adobe/target-tools");
const {
  getResponseHandles,
  getAepEdgeClusterCookie,
} = require("aep-edge-samples-common");
const {
  requestAepEdgePersonalization,
  getPersonalizationExperience,
  sendDisplayEvent,
} = require("aep-edge-samples-common/personalization");
const {
  saveAepEdgeCookies,
  getAepEdgeCookies,
} = require("aep-edge-samples-common/cookies");
const { sendResponse } = require("aep-edge-samples-common/utils");
const fs = require("fs");
const http = require("http");
const https = require("https");

const {
  EDGE_CONFIG_ID_WITH_ANALYTICS,
  ORGANIZATION_ID,
  demoSurfaceUri,
  demoSurfaceName,
  AEP_EDGE_DOMAIN,
  FPID,
} = process.env;

// Initialize the Express app
const httpApp = express();
const httpsApp = express();

// Setup cookie parsing middleware and static file serving from the /public directory
httpsApp.use(cookieParser());
httpsApp.use(express.static(path.resolve(__dirname, "..", "public")));
httpsApp.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded


function prepareTemplateVariables(
  handles,
  personalizationExperienceItems = [],
  defaultTemplateVariables = {}
) {
  const templateVariables = {
    heroImageName: "demo-marketing-decision1-default.png",
    buttonActions: [],
    userName: "User Name",
    product: "",
    loyaltyTier: "",
    ...defaultTemplateVariables,
  };

  if (personalizationExperienceItems.length > 0) {
    const { content = {} } = personalizationExperienceItems[0].data;
    const {
      heroImageName = "demo-marketing-decision1-default.png",
      buttonActions = [],
      userName = "User Name",
      product = "",
      loyaltyTier = "",
    } = content;
    templateVariables.heroImageName = heroImageName;
    templateVariables.buttonActions = buttonActions;
    templateVariables.userName = userName;
    templateVariables.product = product;
    templateVariables.loyaltyTier = loyaltyTier;
  }
  if(templateVariables.loyaltyTier === "diamond") {
    templateVariables.heroImageName = "https://s7ap1.scene7.com/is/image/varuncloudready/LunchClub?&$productImage=varuncloudready/burger&$name=BigWhop&$price=%2420%20only&$description=Delicious%20juicy%20burger&$showDiscount=0&$discount=20%25%5Cline%20OFF&$showDiscount=0";
  }
  else if(templateVariables.loyaltyTier === "platinum") {
    templateVariables.heroImageName = "https://s7ap1.scene7.com/is/image/varuncloudready/LunchClub?&$productImage=varuncloudready/pizza&$name=Veggie%20Pizza&$price=%2410%20only&$description=Delicious%20Veg%20pizza&$showDiscount=1&$discount=30%25%5Cline%20OFF";
  }
  else if(templateVariables.loyaltyTier === "gold") {
    templateVariables.heroImageName = "https://s7ap1.scene7.com/is/image/varuncloudready/LunchClub?&$productImage=varuncloudready/fries&$name=Peri%20Peri%20Fries&$price=%2410%20only&$description=Crispy%20fries&$showDiscount=0&$discount=5%25%5Cline%20OFF";
  }
  console.log("templateVariables", templateVariables);

  return templateVariables;
}

let email = '';
let password = '';

httpsApp.get("/login", async (req, res) => {
  let template = loadHandlebarsTemplate("login");
  let templateVariables = {
    pageTitle: "Lunch Club login page",
  };
  sendResponse({
    req,
    res,
    template,
    templateVariables,
  });
});

// Setup the root route Express app request handler for GET requests
httpsApp.post("/home", async (req, res) => {
  email = req.body.username;
  const aepEdgeClient = createAepEdgeClient(
    EDGE_CONFIG_ID_WITH_ANALYTICS,
    getAepEdgeClusterCookie(ORGANIZATION_ID, req),
    AEP_EDGE_DOMAIN
  );

  const aepEdgeCookies = getAepEdgeCookies(req);

  let template = loadHandlebarsTemplate("index");
  let templateVariables = {
    pageTitle: "Lunch Club Home Page",
  };

  try {
    const aepEdgeResult = await requestAepEdgePersonalization(
      aepEdgeClient,
      req,
      [],
      isString(FPID) && FPID.length > 0
        ? {
            FPID: [createIdentityPayload(FPID)],
          }
        : {
            Email: [
              {
                id: email,
                primary: true,
              },
            ],
          },
      aepEdgeCookies,
      [demoSurfaceUri, demoSurfaceUri.concat(demoSurfaceName)]
    );

    const personalizationExperience = getPersonalizationExperience(
      aepEdgeResult,
      demoSurfaceUri.concat(demoSurfaceName)
    );

    sendDisplayEvent(
      aepEdgeClient,
      req,
      [personalizationExperience].filter(
        (experience) => Object.keys(experience) > 0
      ),
      aepEdgeCookies
    );

    templateVariables = prepareTemplateVariables(
      getResponseHandles(aepEdgeResult),
      personalizationExperience.items,
      templateVariables
    );
    saveAepEdgeCookies(ORGANIZATION_ID, { req, res, aepEdgeResult });
    sendResponse({
      req,
      res,
      template,
      templateVariables,
      aepEdgeResult,
    });
  } catch (e) {
    template = loadHandlebarsTemplate("error");
    templateVariables.error = e.message;
    sendResponse({
      req,
      res,
      template,
      templateVariables,
    });
  }
});

// Startup the Express server listener
const httpsOptions = {
  key: fs.readFileSync("./key.pem"),
  cert: fs.readFileSync("./cert.pem"),
};

https.createServer(httpsOptions, httpsApp).listen(443, () => {
  console.log(`https server started`);
});

http.createServer(httpApp).listen(80, () => {
  console.log(`http server started`);
  httpApp.all("*", (req, res) => {
    return res.redirect(
      301,
      ["https://", req.headers.host, req.originalUrl].join("")
    );
  });
});

// Stop the server on any app warnings
process.on("warning", (e) => {
  console.warn("Node application warning", e);
  process.exit(-1);
});
