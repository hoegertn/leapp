import {Injectable, NgZone} from '@angular/core';
import {IdpResponseType, WorkspaceService} from './workspace.service';
import {ConfigurationService} from '../services-system/configuration.service';
import {AccountType} from '../models/AccountType';
import {AppService, LoggerLevel, ToastLevel} from '../services-system/app.service';
import {SessionService} from './session.service';
import {FederatedAccountService} from './federated-account.service';
import {TrusterAccountService} from './truster-account.service';
import {AzureAccountService} from './azure-account.service';
import {Router} from '@angular/router';
import {Session} from '../models/session';
import {Subscription} from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ProviderManagerService {
  private form;
  private accountType;
  private accountId;
  private selectedAccount;
  private selectedSession;
  private selectedRole;
  private selectedRegion;
  private googleSubscription: Subscription;
  private selectedIdpUrl: any;

  /**
   * Used to manage all the choices done in the app regarding the correct provider to use:
   * this way we have a first step encapsulating logic and working on modularity
   */
  constructor(
    private router: Router,
    private ngZone: NgZone,
    private appService: AppService,
    private configurationService: ConfigurationService,
    private workspaceService: WorkspaceService,
    private sessionService: SessionService,
    private federatedAccountService: FederatedAccountService,
    private trusterAccountService: TrusterAccountService,
    private azureAccountService: AzureAccountService
  ) {

  }

  /**
   * Get all the federated roles of an account
   * @param selectedSession - the one selected to get the roles
   */
  getFederatedRole(selectedSession: Session) {
    const accountName = selectedSession.account.accountName;
    const roles = [];

    // Get the appropriate roles
    const filteredAccounts = this.sessionService.listSessions().filter(session => (session.account.accountName === accountName)).map(s => s.account);
    if (filteredAccounts !== undefined && filteredAccounts !== null && filteredAccounts.length > 0) {
      for (let i = 0; i < filteredAccounts.length; i++) {
        const account = filteredAccounts[i];

        if (account.type === AccountType.AWS || account.type === AccountType.AWS_SSO) {
          // The federated roles we have obtained from the filter
          const federatedRole = account.role;

          // Set the federated role automatically
          this.appService.logger(`Retrieved federated role for: ${accountName}`, LoggerLevel.INFO, this, JSON.stringify({ federatedRole, selectedAccountNumber: account.accountNumber, selectedrole: federatedRole.name }, null, 3));
          roles.push({ federatedRole, selectedAccountNumber: account.accountNumber, selectedrole: federatedRole.name });
        } else if (account.type === AccountType.AWS_PLAIN_USER) {

          this.appService.logger(`Retrieved federated role for: ${accountName}`, LoggerLevel.INFO, this, JSON.stringify({federatedRole: {name: 'no need'}, selectedAccountNumber: account.accountNumber, selectedrole: 'no need'}, null, 3));
          roles.push({federatedRole: {name: 'no need'}, selectedAccountNumber: account.accountNumber, selectedrole: 'no need'});
        }

      }
      return roles;
    }

    // no account so no roles
    return [{ federatedRole: null, selectedAccountNumber: null, selectedrole: null }];
  }

  /**
   * Save the first account of the Application
   * @param accountId - the account Id that we are creating
   * @param accountType - the account Type you have chosen
   * @param selectedSession - the selected session
   * @param selectedRole - the selected role of the parent
   * @param selectedRegion - the region to select for aws
   * @param selectedIdpUrl - the current idp url to use for saml if needed plus id
   * @param form - the form to use
   */

  // TODO: Why we need to save configurations and create the workspace here? it should be done invoked in the start screen and
  saveFirstAccount(accountId, accountType, selectedSession: Session, selectedRole, selectedRegion, selectedIdpUrl, form) {
    // Set our variable to avoid sending them to all methods;
    // besides the scope of this service is to manage saving and editing
    // of multi providers so having some helper class variables is ok
    this.accountId = accountId;
    this.accountType = accountType;
    this.selectedSession = selectedSession;
    this.selectedRole = selectedRole;
    this.selectedRegion = selectedRegion;
    this.selectedIdpUrl = selectedIdpUrl;
    this.form = form;

    // TODO: ?? Why I need to call Google?
    // Before we need to save the first workspace and call google: this is done only the first time so it is not used in other classes
    // Now we get the default configuration to obtain the previously saved idp url
    const configuration = this.configurationService.getConfigurationFileSync();

    // TODO: WHy SAML is essential?
    // Set our response type
    const responseType = IdpResponseType.SAML;

    // Update Configuration
    if (accountType === AccountType.AWS) {

      // TODO: What I am updating?
      this.configurationService.updateConfigurationFileSync(configuration);

      // When the token is received save it and go to the setup page for the first account
      if (this.googleSubscription) { this.googleSubscription.unsubscribe(); }
      this.googleSubscription = this.workspaceService.googleEmit.subscribe((googleToken) => this.ngZone.run(() => {
        this.createNewWorkspace(googleToken, this.selectedIdpUrl, responseType);
        this.appService.logger(`Saving first account with a federated account (already done google token emit)`, LoggerLevel.INFO, this);
      }));

      // Call the service for working on the first login event to the user idp
      // We add the helper for account choosing just to be sure to give the possibility to call the correct user
      this.workspaceService.getIdpTokenInSetup(this.selectedIdpUrl.url, responseType);
    } else {
      this.appService.logger(`Saving first account with a plain or azure account`, LoggerLevel.INFO, this);
      this.createNewWorkspace(undefined, undefined, responseType);
    }
  }

  /**
   * Save the first account of the Application
   * @param accountId - the account Id that we are creating
   * @param accountType - the account Type you have chosen
   * @param selectedSession - the selected session
   * @param selectedRole - the selected role of the parent
   * @param selectedRegion - the region to select for aws
   * @param selectedIdpUrl - the idp url to use for saml auth if needed plus id
   * @param form - the form to use
   */
  saveAccount(accountId, accountType, selectedSession: Session, selectedRole, selectedRegion, selectedIdpUrl, form) {
    // Set our variable to avoid sending them to all methods;
    // besides the scope of this service is to manage saving and editing
    // of multi providers so having some helper class variables is ok
    this.accountId = accountId;
    this.accountType = accountType;
    if (selectedSession) {
      this.selectedAccount = selectedSession.account;
    }
    this.selectedSession = selectedSession;
    this.selectedRole = selectedRole;
    this.selectedRegion = selectedRegion;
    this.selectedIdpUrl = selectedIdpUrl;
    this.form = form;
    this.decideSavingMethodAndSave();
  }

  /**
   * Edit the account of the Application, the system is able to understand which one to edit and how
   * @param session - the session to be edited
   * @param selectedRegion - the default region to set
   * @param form - the form to check about
   */
  editAccount(session: Session, selectedRegion, form) {
    // Set our variable to avoid sending them to all methods;
    // besides the scope of this service is to manage saving and editing
    // of multi providers so having some helper class variables is ok
    this.selectedSession = session;
    this.accountType = session.account.type;
    this.selectedRegion = selectedRegion;
    this.form = form;
    this.decideEditingMethodAndSave();
  }

  /**
   * When the data from Google is received, generate a new workspace or check errors, etc.
   */
  // TODO: Why there are 2 createNewWorkspace functions?
  createNewWorkspace(googleToken, federationUrl, responseType) {
    const name = 'default';
    const result = this.workspaceService.createNewWorkspace(googleToken, federationUrl, name, responseType);
    if (result) {
      this.decideSavingMethodAndSave();
    } else {
      // Error: return to dependencies page
      this.appService.toast('Can\'t create a new workspace for first account', ToastLevel.ERROR, 'Creation error');
    }
  }

  decideSavingMethodAndSave() {
    let result = true;
    switch (this.accountType) {
      case AccountType.AWS:
        result = this.saveAwsFederatedAccount();
        break;
      case AccountType.AWS_TRUSTER:
        result = this.saveAwsTrusterAccount();
        break;
      case AccountType.AWS_PLAIN_USER:
        result = this.savePlainCredentials();
        break;
      case AccountType.AZURE:
        result = this.saveAzureAccount();
        break;
    }

    if (result) {
      // Then go to next page
      this.appService.logger('managed to save session', LoggerLevel.INFO, this);
      this.router.navigate(['/sessions', 'session-selected'], {queryParams: {accountId: this.accountId}});
    }
  }

  decideEditingMethodAndSave() {
    let result = true;
    switch (this.accountType) {
      case AccountType.AWS:
        result = true; // this.saveAwsFederatedAccount();
        break;
      case AccountType.AWS_TRUSTER:
        result = true; // this.saveAwsTrusterAccount();
        break;
      case AccountType.AWS_PLAIN_USER:
        result = this.editPlainCredentials();
        break;
      case AccountType.AZURE:
        result = true; // this.saveAzureAccount();
        break;
    }

    if (result) {
      // Then go to next page
      this.router.navigate(['/sessions', 'session-selected'], {queryParams: {accountId: this.accountId}});
    }
  }

  /**
   * Save azure account
   */
  saveAzureAccount() {
    if (this.formValid(this.form, this.accountType)) {
      try {
        return this.azureAccountService.addAzureAccountToWorkSpace(
          this.form.value.subscriptionId,
          this.form.value.tenantId,
          this.form.value.name,
          this.form.value.azureLocation);
      } catch (err) {
        this.appService.logger('Error creating account', LoggerLevel.ERROR, this, err.stack);
        this.appService.toast(err, ToastLevel.ERROR);
        return false;
      }
    } else {
      this.appService.logger('Missing required parameters for account', LoggerLevel.ERROR, this, JSON.stringify(this.form.getRawValue(), null, 3));
      this.appService.toast('Missing required parameters for account', ToastLevel.WARN, 'Add required elements to Account');
      return false;
    }
  }

  /**
   * This will be removed after created the correct file also in normal mode
   */
  saveAwsTrusterAccount() {
    if (this.formValid(this.form, this.accountType)) {
      try {
        // Try to create the truster account
        return this.trusterAccountService.addTrusterAccountToWorkSpace(
          this.form.value.accountNumber,
          this.form.value.name,
          (this.selectedSession as Session).id,
          this.selectedRole,
          this.generateRolesFromNames(this.form),
          this.form.value.idpArn,
          this.selectedRegion);
      } catch (err) {
        this.appService.logger(err, LoggerLevel.ERROR, this, err.stack);
        this.appService.toast(err, ToastLevel.ERROR);
        return false;
      }
    } else {
      this.appService.toast('Add at least one role to the account', ToastLevel.WARN, 'Add Role to Account');
      return false;
    }
  }

  saveAwsFederatedAccount() {
    if (this.formValid(this.form, this.accountType)) {
      try {
        // Add a federation Account to the workspace
        return this.federatedAccountService.addFederatedAccountToWorkSpace(
          this.selectedIdpUrl,
          this.form.value.accountNumber,
          this.form.value.name,
          this.generateRolesFromNames(this.form),
          this.form.value.idpArn,
          this.selectedRegion,
        );
      } catch (err) {
        this.appService.logger(err, LoggerLevel.ERROR, this, err.stack);
        this.appService.toast(err, ToastLevel.ERROR);
        return false;
      }
    } else {
      this.appService.toast('Add at least one role to the account', ToastLevel.WARN, 'Add Role to Account');
      return false;
    }
  }

  savePlainCredentials() {
    this.federatedAccountService.addPlainAccountToWorkSpace(
      this.form.value.accountNumber,
      this.form.value.name,
      this.form.value.plainUser,
      this.form.value.secretKey.trim(),
      this.form.value.accessKey.trim(),
      this.form.value.mfaDevice.trim(),
      this.selectedRegion);
    return true;
  }

  editPlainCredentials() {
    this.federatedAccountService.editPlainAccountToWorkSpace(
      this.selectedSession,
      this.form.value.accessKey.trim(),
      this.form.value.secretKey.trim(),
      this.form.value.mfaDevice.trim(),
      this.selectedRegion,
    );
    return true;
  }

  /**
   * Because the form is complex we need a custom form validation
   * In the future we will put this in a service to create validation factory:
   * this way depending on new accounts we jkust need to pass the form object to the validator
   */
  formValid(form, accountType) {
    // First check the type of account we are creating
    if (accountType !== AccountType.AZURE) {
      let check;

      // We are in AWS check if we are saving a Federated or a Truster
      switch (accountType) {
        case AccountType.AWS:
          // Check Federated fields
          check = form.controls['name'].valid &&
            form.get('federationUrl').value  &&
            form.controls['accountNumber'].valid &&
            form.controls['role'].valid &&
            form.controls['idpArn'].valid;
          return check;
        case AccountType.AWS_TRUSTER:
          // Check Federated fields
          check = form.controls['name'].valid &&
            form.controls['accountNumber'].valid &&
            form.controls['role'].valid &&
            form.controls['federatedAccount'].valid &&
            form.controls['federatedRole'].valid;
          return check;
        case AccountType.AWS_PLAIN_USER:
          check = form.controls['name'].valid &&
            form.controls['accountNumber'].valid &&
            form.controls['accessKey'].valid &&
            form.controls['secretKey'].valid;
          return check;
      }
    } else {
      // Check Azure fields
      const check = form.controls['name'].valid &&
             form.controls['subscriptionId'].valid &&
             form.controls['tenantId'].valid;
      this.appService.logger(`AZURE Form is valid: ${check}`, LoggerLevel.INFO, this);
      return check;
    }
    this.appService.logger(`Form is not valid`, LoggerLevel.WARN, this);
    return false;
  }

  /**
   * By using the names we create the corresponding roles to be pushed inside the account configuration
   * @param form - the form to access the role from
   * @returns - {any[]} - returns a list of aws roles
   */
  generateRolesFromNames(form) {
    const role = form.controls['role'].value;
    const accountNumber = form.controls['accountNumber'].value;
    return { name: role, roleArn: `arn:aws:iam::${accountNumber}:role/${role}` };
  }

  getFederatedAccounts() {
    return this.federatedAccountService.listFederatedAccountInWorkSpace();
  }

  getPlainAccounts() {
    return this.federatedAccountService.listPlainAccountsInWorkspace();
  }

  getSSOAccounts() {
    const workspace = this.configurationService.getDefaultWorkspaceSync();
    if (workspace && workspace.sessions && workspace.sessions.length > 0) {
      return workspace.sessions.filter(sess => (sess.account.type === AccountType.AWS_SSO)); // .map(s => s.account);
    } else {
      return [];
    }
  }

  getFederableAccounts() {
    return this.getFederatedAccounts().concat(this.getPlainAccounts()).concat(this.getSSOAccounts());
  }
}

