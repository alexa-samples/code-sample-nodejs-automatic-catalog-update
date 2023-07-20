Automatically update your catalogs and skill 
=============

![Tutorial Header](https://m.media-amazon.com/images/G/01/mobile-apps/dex/alexa/alexa-skills-kit/tutorials/fact/header._TTH_.png)


## What You Will Need
*  [Amazon Developer Portal Account](http://developer.amazon.com)
*  [Amazon Web Services Account](http://aws.amazon.com/)
*  [ASK NodeJS SDK](https://github.com/alexa/alexa-skills-kit-sdk-for-nodejs)
*  [ASK CLI](https://developer.amazon.com/en-US/docs/alexa/smapi/quick-start-alexa-skills-kit-command-line-interface.html)
*  [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
*  A basic understanding of Node.js and TypeScript

## What this code sample will do
This code sample will update your catalogs and skill with the use of ASK NodeJS SDK. Developers will need to provide their own client id, client secret, and refresh token.

## Instructions
1. [Obtain LWA client ID and client secret](https://developer.amazon.com/en-US/docs/alexa/smapi/get-access-token-smapi.html#configure-lwa-security-profile).
2. [Generate refresh token using ask cli](https://developer.amazon.com/en-US/docs/alexa/smapi/ask-cli-command-reference.html#generate-lwa-tokens).
3. Input obtained ids and token to `index.js`.
4. Replace sample catalogId and URL with your values. You can update more than one catalog.
5. Input skill id to update in `index.js`
6. Run `node index.js` from package root to update catalog and skill.
7. Follow steps below to run update periodically

### Running script in AWS lambda
1. Set up your CDK project

```
npm install -g aws-cdk
cdk init app --language=typescript
```

2. Install AWS SDK if not already installed

```
npm install aws-sdk
```

3. Add the necessary imports in lib/{AnyStackName}.ts:

```
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
```

4. Create the AWS Lambda function and configuration to run on schedule using AWS Event Bridge. Modify the cron function to configure how often to update

```
export class YourStackNameStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Define the Lambda function
    const lambdaFunction = new lambda.Function(this, 'YourLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset("PATH_TO_ASK_AUTOMATIC_CATALOG_UPDATE_FUNCTION"),
    });

    // Create an EventBridge rule to trigger the Lambda function every hour
    const rule = new events.Rule(this, 'YourRule', {
      schedule: events.Schedule.cron({ hour: '0' }),
    });

    // Add the Lambda function as the target of the EventBridge rule
    rule.addTarget(new targets.LambdaFunction(lambdaFunction));
  }
}

```

5. Build project using `npm run build`
6. Deploy stack using `cdk deploy`

*Note: This can be done without AWS CDK. Simply zip up node package and configure AWS lambda/Eventbrige via AWS console*

### (Optional) To submit skill for certification after skill update.
Modify the `runInteractionModelUpdateWorkflow` function in `index.js` to the following to submit skill for instant publish.

*Note: Skill will not instant publish if there are changes other than catalog values.*

```
  async function runInteractionModelUpdateWorkflow() {
    try {
      await createDirectories();
      await createInteractionModelCatalogVersion();
      await getSkillPackageAndUpdateCatalogVersion();
      await submitSkillForCertification(); 
    } catch (error) {
      console.error('Error when running update workflow', error);
      throw new Error('Workflow failed', {cause: error});
    }
  }
```
