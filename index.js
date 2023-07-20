// Copyright 2023 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
// Licensed under the Amazon Software License  http://aws.amazon.com/asl/

const Alexa = require('ask-smapi-sdk');
const https = require('https');
const fs = require('fs');
const AdmZip = require('adm-zip');
const axios = require('axios');

const refreshToken = '';
const clientId = '';
const clientSecret = '';
const catalogToVersionData = {
  'amzn1.ask.interactionModel.catalog.sample': {source : {type : 'URL', url: 'https://ingredientjson.s3.amazonaws.com/ingredients.json'}}
  // add new entry to object if you would like multiple catalogs updated
}
const skillId = ''; //Input skill id
const localesToUpdate = ['en-US']; //add or modify locales as necessary 
const catalogIdVersionMap = {};
const SKILL_PACKAGE_ZIP = 'skillpackage.zip';
const LOCATION = 'location';
const CATALOG_VALUE_SUPPLIER = 'CatalogValueSupplier';

const refreshTokenConfig = {
    clientId,
    clientSecret, 
    refreshToken
}

const smapiClient = new Alexa.StandardSmapiClientBuilder()
    .withRefreshTokenConfig(refreshTokenConfig)
    .client();
    
exports.handler = async (event, context, callback) => {
    try {
        console.log('Running via AWS lambda');
        await runInteractionModelUpdateWorkflow();
    } catch (err) {
        console.error(err);
        callback(err);
    }
};

runInteractionModelUpdateWorkflow();

async function submitSkillForCertification() {
  try {
    await smapiClient.submitSkillForCertificationV1(skillId);
  } catch (err) {
    console.log('Error when submitting skill for certification', err);
    throw new Error('Error when submitting skill for certification: ' + err, {cause: err})
  }
}

async function createInteractionModelCatalogVersion() {
    try {
      for (const catalogId of Object.keys(catalogToVersionData)) {
        const response = await smapiClient.callCreateInteractionModelCatalogVersionV1(catalogId, catalogToVersionData[catalogId]);
        const updateRequest = getIdFromHeader(response);
  
        const responseFromCatalogUpdate = await waitForCatalogUpdateToSucceed(catalogId, updateRequest)
        console.log(JSON.stringify(responseFromCatalogUpdate));
        catalogIdVersionMap[catalogId] = responseFromCatalogUpdate.lastUpdateRequest.version;
      }
    
    } catch (err) {
      throw new Error('Error when creating new version for catalog', {cause: err})
    }
  }

  async function waitForCatalogUpdateToSucceed(catalogId, updateId) {
    const MAX_RETRIES = 5;
    const BASE_TIMEOUT = 1000;
  
    return retryWithBackoff(async () => {
      const response = await smapiClient.getInteractionModelCatalogUpdateStatusV1(catalogId, updateId);
      const status = response.lastUpdateRequest.status;
  
      if (status === 'SUCCEEDED') {
        return response;
      } else if (status === 'FAILED') {
        throw new Error('Update failed with errors');
      }
      throw new Error('Update failed to get successful response');
    }, MAX_RETRIES, BASE_TIMEOUT);
  }

  async function waitForExport(exportId) {
    const MAX_RETRIES = 5;
    const BASE_TIMEOUT = 1000;
  
    return retryWithBackoff(async () => {
      const response = await smapiClient.getStatusOfExportRequestV1(exportId);
      const status = response.status;
  
      if (status === 'SUCCEEDED') {
        return response;
      } else if (status === 'FAILED') {
        throw new Error('Export failed with errors');
      }
      throw new Error('Update failed to get successful response');
    }, MAX_RETRIES, BASE_TIMEOUT);
  }

async function waitForImport(importId) {
  const MAX_RETRIES = 5;
  const BASE_TIMEOUT = 2000;

  return retryWithBackoff(async () => {
    const response = await smapiClient.getImportStatusV1(importId);
    const status = response.status;

    if (status === 'SUCCEEDED') {
      console.log('Skill import succeeded');
      return response;
    } else if (status === 'FAILED') {
      throw new Error('Import failed with errors');
    }
    throw new Error('Update failed to get successful response');
  }, MAX_RETRIES, BASE_TIMEOUT);
}


async function downloadSkillPackage(url, destination) {
  try {
      await new Promise((resolve, reject) => {
        https.get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`File download failed. Status Code: ${response.statusCode}`));
            return;
          }

          const fileStream = fs.createWriteStream(destination);
          response.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });

          fileStream.on('error', (error) => {
            reject(error);
          });
        }).on('error', (error) => {
          reject(error);
        });
      });
      console.log('File downloaded successfully.');

      const zip = new AdmZip(destination);
      zip.extractAllTo('./extracted', true);
      console.log('Zip file extracted successfully.');
    } catch (error) {
      console.error('File download failed:', error);
      throw new Error('Downloading skill package failed', {cause: err});
    }
}

async function uploadToS3() {
  try {
      const fileData = fs.readFileSync(SKILL_PACKAGE_ZIP);
      const uploadResponse = await smapiClient.createUploadUrlV1()

      const response = await axios.put(uploadResponse.uploadUrl, fileData, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fs.statSync(SKILL_PACKAGE_ZIP).size
        }
      });

      console.log(`Upload response status: ${response.status}`);
      const updateSkillPackageRequest = {
        location : uploadResponse.uploadUrl
      }
      const importResponse = await smapiClient.callImportSkillPackageV1(updateSkillPackageRequest, skillId)
      const importId = getIdFromHeader(importResponse)
      await waitForImport(importId)
    } catch (error) {
      console.error('Upload error:', error);
    }
};

  async function zipFiles() {
    const zip = new AdmZip();
    zip.addLocalFolder('./extracted');
    zip.writeZip(SKILL_PACKAGE_ZIP);
    console.log('Zipped files')
  };

  async function runInteractionModelUpdateWorkflow() {
    try {
      await createDirectories();
      await createInteractionModelCatalogVersion();
      await getSkillPackageAndUpdateCatalogVersion();
      //Uncomment to submit skill for certification
      //await submitSkillForCertification(); 
    } catch (error) {
      console.error('Error when running update workflow', error);
      throw new Error('Workflow failed', {cause: error});
    }
  }

  async function createDirectories() {
    try {
      if (!fs.existsSync('./downloaded')) {
        fs.mkdirSync('./downloaded');
      }
      if (!fs.existsSync('./extracted')) {
         fs.mkdirSync('./extracted');
      }        
    } catch (err) {
      console.error('Error creating directory', err);
    }
  }

  async function getSkillPackageAndUpdateCatalogVersion() {
    try {
      const packageDownloadUrl = await createExportAndPollTillCompletion();
      await downloadSkillPackage(packageDownloadUrl, './downloaded/skillPackage.zip');
      await updateCatalogVersionInInteractionModel();
      await zipFiles();
      await uploadToS3();
    } catch (error) {
      console.error('Error when getting skill package', error)
      throw new Error('Error when getting skill package', {cause: error});
    }
  }

  async function createExportAndPollTillCompletion() {
    try {
      const exportId = await createExport();
      return (await waitForExport(exportId)).skill.location;
    } catch (error) {
      console.error('Error when creating exporting and polling for status', error);
      throw new Error('Error when creating exporting and polling for status', {cause: error});
    }
  }

  async function createExport() {
    try { 
      const exportResponse = await smapiClient.callCreateExportRequestForSkillV1(skillId, 'development')
      const exportId = getIdFromHeader(exportResponse) 
      console.log('ExportId: ' + exportId);
      return exportId;
    } catch (error) {
      console.error('Error when trying to create export for skill', error);
      throw new Error('Error when trying to create export for skill', {cause: error});
    }
  }

  async function updateCatalogVersionInInteractionModel() {
    try {
      localesToUpdate.forEach((locale) => {
        const interactionModel = readJsonFile(`./extracted/interactionModels/custom/${locale}.json`);
        const types = interactionModel.interactionModel.languageModel.types;
        types.forEach((type) => {
          if (type.valueSupplier != null && type.valueSupplier.type == CATALOG_VALUE_SUPPLIER) {
              if (catalogToVersionData.hasOwnProperty(type.valueSupplier.valueCatalog.catalogId)) {
                  type.valueSupplier.valueCatalog.version = catalogIdVersionMap[type.valueSupplier.valueCatalog.catalogId];
              }
          }
        });
        fs.writeFileSync(`./extracted/interactionModels/custom/${locale}.json`, JSON.stringify(interactionModel, null, 2))
      })
    } catch (error) {
      console.error('Error when updating Catalog Version in Interaction Model', error);
      throw new Error('Error when updating Catalog Version in Interaction Model', {cause: error});
    }
  
  }

  function readJsonFile(filePath) {
    try {
      // Read the file synchronously
      const fileContent = fs.readFileSync(filePath, 'utf8');
  
      // Parse the JSON content into a JavaScript object
      const jsonObject = JSON.parse(fileContent);
  
      return jsonObject;
    } catch (error) {
      // Handle any errors that occur during file reading or JSON parsing
      console.error(`Error reading JSON file: ${error}`);
      return null;
    }
  }

  function getIdFromHeader(response) {
    const locationId = Alexa.getValueFromHeader(response.headers, LOCATION).at(0).toString();
    const locationSegment = locationId.split('/');
    return locationSegment[locationSegment.length - 1];
  }

  async function retryWithBackoff(action, maxRetries, baseTimeout) {
    let retries = 0;
    let timeout = baseTimeout;
  
    do {
      try {
        return await action();
      } catch (error) {
        retries++;
        timeout = Math.pow(2, retries) * baseTimeout;
        console.log(`Update in progress, retrying in ${timeout} milliseconds...`);
        await new Promise((resolve) => setTimeout(resolve, timeout));
      }
    } while (retries < maxRetries);
  
    throw new Error(`Update did not succeed after ${maxRetries} retries`);
  }