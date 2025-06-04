import {App, Stack} from "aws-cdk-lib";
import * as fileSystemPath from "path";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import {
     TYPES,
     ENUMS,
     DiscoveryServiceDefaultData,
     DiscoveryServiceConfigurator,
     AwsServerlessStackBase,
} from "@cny-common/aws.cdk.ts";
import {generateResourceName} from "@cny-helpers/nodejs";

export class ApiGenStack extends AwsServerlessStackBase {
     protected apiGatewayObj: TYPES.GateWayGroup;
     protected stackObj: {
          [gatewayGroup: string]: TYPES.GateWayGroup;
     };
     constructor(scope: App, id: string, props: {inputData: TYPES.ExtendedGroupEndpoints; dependsOn?: Stack[]}) {
          super(scope, id, {
               env: {
                    region: process.env.CDK_DEFAULT_REGION,
                    account: process.env.CDK_DEFAULT_ACCOUNT,
               },
          });
          const {inputData} = props;

          this.defaultData = new DiscoveryServiceDefaultData(inputData);
          this.defaultData.initializeValues();

          this.lambdaDeploymentType = ENUMS.LambdaCreationType.Asset;

          this.stackObj = Object.values(inputData)[0];
          this.apiGatewayObj = Object.values(this.stackObj)[0];
          this.productShortName = this.apiGatewayObj.productShortName.toLowerCase();
          this.orgShortName = this.apiGatewayObj.orgShortName?.toLowerCase();
          this.cors = this.apiGatewayObj["cors"];
          this.stage = this.apiGatewayObj.stage;
          this.apiGatewayName = `${Object.keys(this.stackObj)[0]}`;
          this.resourceName = this.apiGatewayObj.endpointsInfoArray[0].resourceName;
          this.dsConfigurator = new DiscoveryServiceConfigurator({
               parentStack: this,
               stage: this.stage!,
               resourceName: this.resourceName,
               productShortName: this.productShortName,
               orgShortName: this.orgShortName,
               discoveryTablePrefix: "root",
          });
          this.endpoints = this.apiGatewayObj.endpointsInfoArray;
          this.isAuthorizationExists = this.apiGatewayObj.features[ENUMS.ApiFeatures.Authorization];
          this.mappingDomainSubDomainPrefix = `${
               this.apiGatewayObj.serverUrlSubDomain ? `${this.apiGatewayObj.serverUrlSubDomain}-` : ""
          }`;
          this.mappingDomain = `${this.mappingDomainSubDomainPrefix}${this.stage}.${this.apiGatewayObj.serverUrl!}`;
     }

     async doDeployment(): Promise<void> {
          const {productShortName, orgShortName, stage} = this;

          const productsTable = dynamodb.Table.fromTableName(
               this,
               `${stage}-productsTableName`,
               generateResourceName({productShortName, orgShortName, stage, resourceConstant: `products`})
          );

          const usersTable = dynamodb.Table.fromTableName(
               this,
               `${stage}-usersTableName`,
               generateResourceName({productShortName, orgShortName, stage, resourceConstant: `users`})
          );

          const usersPolicyTable = dynamodb.Table.fromTableName(
               this,
               `${stage}-usersPolicyTableName`,
               generateResourceName({productShortName, orgShortName, stage, resourceConstant: `users-policy`})
          );

          const globalCounterTable = dynamodb.Table.fromTableName(
               this,
               `${stage}-globalCounterTableName`,
               generateResourceName({productShortName, orgShortName, stage, resourceConstant: `global-counter`})
          );

          const userPoolTable = dynamodb.Table.fromTableName(
               this,
               `${stage}-userPool`,
               generateResourceName({
                    productShortName: productShortName.toLowerCase(),
                    orgShortName: orgShortName?.toLowerCase(),
                    stage,
                    resourceConstant: `user-pool`,
               })
          );

          if (this.isAuthorizationExists) {
               // Authorizer
               this.authorizerLambdaPath = fileSystemPath.join(__dirname, this.apiGatewayObj.features.Authorization!.path);
               this.authorizerEnvironment = {
                    USERS_POLICY_TABLE_NAME: usersPolicyTable.tableName,
                    USERS_TABLE_NAME: usersTable.tableName,
                    stage: stage!,
                    PRODUCTS_TABLE_NAME: productsTable.tableName,
                    USER_POOL_TABLE_NAME: userPoolTable.tableName,
               };
          }

          await this.createApiGateway();

          if (this.isAuthorizationExists) {
               this.grantPermissionToAuthorizer([usersTable, usersPolicyTable, productsTable, userPoolTable]);
          }

          const lambdaRole = new iam.Role(this, "LambdaRole-SystemManagerGetAccess", {
               assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
          });

          lambdaRole.addToPolicy(
               new iam.PolicyStatement({
                    resources: ["*"],
                    actions: ["ssm:GetParameter", "logs:*"],
               })
          );

          this.endpoints.forEach(async (endpoint) => {
               const environment = {
                    STAGE: this.stage!,
                    DEFAULT_DYNAMODB_TABLE_NAME: productsTable.tableName,
                    GLOBAL_COUNTER_TABLE_NAME: globalCounterTable.tableName,
               };

               const lambdaPath = fileSystemPath.join(__dirname, `./lambda/${endpoint.serviceMethodName}/src/index.js`);

               await this.createNodejsLambda({
                    endpoint,
                    environment,
                    lambdaPath,
                    awsResourceObj: {
                         products: productsTable,
                         globalCounter: globalCounterTable,
                    },
                    lambdaRole,
                    disableAuthorizer: endpoint.disableAuthorizer,
               });
          });
     }
}
