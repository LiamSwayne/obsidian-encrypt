import { MarkdownRenderer, Menu, Notice, Setting, TextFileView } from 'obsidian';
import { WorkspaceLeaf } from "obsidian";
import { SessionPasswordService } from 'src/services/SessionPasswordService';
import { UiHelper } from 'src/services/UiHelper';
import { IFeatureWholeNoteEncryptSettings } from './IFeatureWholeNoteEncryptSettings';
import { ObsidianEx } from 'src/services/ObsidianEx';
import { FileDataHelper, JsonFileEncoding } from 'src/services/FileDataHelper';
import { ENCRYPTED_FILE_EXTENSION } from 'src/services/Constants';

enum EncryptedFileContentViewStateEnum{
	init,
	decryptNote,
	editNote,
	changePassword,
	newNote
}

export enum EditViewEnum{
	source = 'Source',
	reading = 'Reading',
}

export const VIEW_TYPE_ENCRYPTED_FILE_CONTENT = "meld-encrypted-file-content-view";
export class EncryptedFileContentView extends TextFileView {
	
	private iconReadingView = 'book-open';
	private iconSourceView = 'code';
	private iconToggleEditView = 'edit';
	private iconLockFile = 'lock';
	private iconChangePassword = 'key';

	// State
	settings : IFeatureWholeNoteEncryptSettings;
	currentView : EncryptedFileContentViewStateEnum = EncryptedFileContentViewStateEnum.init;
	encryptionPassword = '';
	hint = '';
	currentEditorSourceText = '';
	defaultEditNoteView : EditViewEnum;
	currentEditNoteMode : EditViewEnum; 
	// end state
	
	elActionIconLockNote : HTMLElement;
	elActionChangePassword : HTMLElement;
	elActionEditView : HTMLElement;
	elActionReadingView : HTMLElement;

	constructor( leaf: WorkspaceLeaf, settings:IFeatureWholeNoteEncryptSettings ) {
		super(leaf);

		this.settings = settings;
		this.defaultEditNoteView = ( settings.defaultView as EditViewEnum ) ?? EditViewEnum.source;
		this.currentEditNoteMode = this.defaultEditNoteView;

		this.elActionEditView = this.addAction( this.iconSourceView, 'Source', () => this.actionToggleEditMode() );
		this.elActionReadingView = this.addAction( this.iconReadingView, 'Reading', () => this.actionToggleEditMode() );
		this.elActionIconLockNote = this.addAction( this.iconLockFile, 'Lock', () => this.actionLockFile() );
		this.elActionChangePassword = this.addAction( this.iconChangePassword, 'Change Password', () => this.actionChangePassword() );
		
		this.elActionEditView.hide();
		this.elActionReadingView.hide();
		this.elActionIconLockNote.hide();
		this.elActionChangePassword.hide();

		this.containerEl.classList.add('meld-encrypt-encrypted-note-view');
		this.contentEl.classList.add('meld-encrypt-encrypted-note-view-content');

	}

	private actionToggleEditMode(){
		if ( this.currentView != EncryptedFileContentViewStateEnum.editNote ){
			return;
		}

		if ( this.currentEditNoteMode == EditViewEnum.reading ){
			this.currentEditNoteMode = EditViewEnum.source;
		}else if ( this.currentEditNoteMode == EditViewEnum.source ){
			this.currentEditNoteMode = EditViewEnum.reading;
		}

		this.refreshView(EncryptedFileContentViewStateEnum.editNote);	
	}

	private actionLockFile(){
		this.encryptionPassword = '';
		SessionPasswordService.clearForFile( this.file );
		this.refreshView(EncryptedFileContentViewStateEnum.decryptNote);
	}

	private actionChangePassword(){
		this.refreshView(EncryptedFileContentViewStateEnum.changePassword);
	}

	override onPaneMenu(menu: Menu, source: string): void {
		//console.debug( {menu, source, 'view': this.currentView});
		if (
			source == 'tab-header'
			&& this.currentView == EncryptedFileContentViewStateEnum.editNote
		){
			menu.addItem( m =>{
				m
					.setSection('action')
					.setIcon( this.iconToggleEditView )
					.setTitle('Toggle Editing/Reading')
					.onClick( () => this.actionToggleEditMode() )
				;
			});
			menu.addItem( m =>{
				m
					.setSection('action')
					.setIcon( this.iconLockFile )
					.setTitle('Lock')
					.onClick( () => this.actionLockFile() )
				;
			});
			menu.addItem( m =>{
				m
					.setSection('action')
					.setIcon( this.iconChangePassword )
					.setTitle('Change Password')
					.onClick( () => this.actionChangePassword() )
				;
			});
		}
		super.onPaneMenu(menu,source);
	}

	private addHeader( container:HTMLElement, title:string ){
		container.createDiv({
			text : `🔐 ${title} 🔐`,
			cls : 'encrypted-note-message'
		});

		if (ObsidianEx.showInlineTitle){
			container.createDiv({
				text: this.file?.basename,
				cls: 'inline-title'
			} );
		}
	}

	private validatePassword ( pw: string ) : string {
		// if ( pw.length == 0 ){
		// 	return 'Password is too short';
		// }
		return '';
	}

	private validateConfirm ( pw: string, cpw: string ) : string {
		const passwordMatch = pw === cpw;
		return passwordMatch ? '' :'Password doesn\'t match';
	}

	private addNewNoteView( container: HTMLElement ) {
		
		this.addHeader(container, 'This note will be encrypted');

		//console.debug('createDecryptNoteView', { "hint": this.hint} );
		const inputContainer = this.addUserInputContainer( container );

		new Setting(inputContainer)
			.setDesc('Please provide a password and hint to start editing this note.')
		;

		const submit = async (password: string, confirm: string, hint:string) => {
			const validPw = this.validatePassword(password);
			const validCpw = this.validateConfirm(password, confirm);
			sPassword.setDesc( validPw );
			sConfirm.setDesc( validCpw );

			if ( validPw.length === 0 && validCpw.length === 0 ){
				
				//set password and hint and open note
				this.encryptionPassword = password;
				this.hint = hint;
				
				// initial content of new note
				if (!ObsidianEx.showInlineTitle){
					this.currentEditorSourceText = `# ${this.file.basename}\n\n\n`;
				}

				await this.encodeAndSave();
				
				SessionPasswordService.putByFile( { password: password, hint: hint }, this.file );

				this.currentEditNoteMode = EditViewEnum.source;
				this.refreshView( EncryptedFileContentViewStateEnum.editNote );

			}
		}

		const bestGuessPassAndHint = SessionPasswordService.getByFile( this.file );
		let password = bestGuessPassAndHint.password;
		let confirm = '';
		let hint = bestGuessPassAndHint.hint;

		const sPassword = UiHelper.buildPasswordSetting({
			container: inputContainer,
			name:'Password:',
			autoFocus : true,
			initialValue: password,
			onChangeCallback: (value) => {
				password = value;
				sPassword.setDesc( this.validatePassword(password) );
				sConfirm.setDesc( this.validateConfirm(password, confirm) );
			},
			onEnterCallback: (value)=>{
				password = value;
				if (password.length > 0){
					sConfirm.controlEl.querySelector('input')?.focus();
				}
			}
		});

		const sConfirm = UiHelper.buildPasswordSetting({
			container: inputContainer,
			name:'Confirm:',
			autoFocus : false,
			onChangeCallback: (value) => {
				confirm = value;
				sPassword.setDesc( this.validatePassword(password) );
				sConfirm.setDesc( this.validateConfirm(password, confirm) );
			},
			onEnterCallback: (value) =>{
				confirm = value;
				const passwordMatch = password === confirm;
				if (passwordMatch){
					sHint.controlEl.querySelector('input')?.focus();
				}
			}
		});

		const sHint = new Setting(inputContainer)
			.setName("Hint:")
			.addText((tc) =>{
				tc.setValue(hint);
				tc.onChange( v => {
					hint = v;
				});
			})
		;
		sHint.controlEl.on('keydown', '*', (ev) =>{
			if ( ev.key === 'Enter' ) {
				ev.preventDefault();
				submit(password, confirm, hint);
			}
		});

		new Setting(inputContainer)
			.addButton( bc => {
				bc
					.setCta()
					.setIcon('go-to-file')
					.setTooltip('Edit')
					.onClick( (ev) => submit(password, confirm, hint) )
				;
			})
		;

	}

	private addDecryptNoteView( container: HTMLElement ) {
		
		this.addHeader( container, 'This note is encrypted');

		const inputContainer = this.addUserInputContainer( container );
		
		new Setting(inputContainer)
			.setDesc('Please provide a password to unlock this note.')
		;

		const sPassword = UiHelper.buildPasswordSetting({
			container: inputContainer,
			name:'Password:',
			autoFocus : true,
			placeholder: this.formatHint(this.hint),
			onChangeCallback: (value) => {
				this.encryptionPassword = value;
				sPassword.setDesc( this.validatePassword(this.encryptionPassword) );
			},
			onEnterCallback: async () => await this.handleDecryptButtonClick()
		});

		new Setting(inputContainer)
			.addButton( bc => {
				bc
					.setCta()
					.setIcon('checkmark')
					.setTooltip('Unlock & Edit')
					.onClick( (evt) => this.handleDecryptButtonClick() )
				;
			})
		;

		// try to decode and go to edit mode if password is known
		const bestGuessPassAndHint = SessionPasswordService.getByFile( this.file );
		this.encryptionPassword = bestGuessPassAndHint.password;

		if ( bestGuessPassAndHint.password.length > 0 ){
			// try to decrypt with known password
			
			this.decryptWithPassword( bestGuessPassAndHint.password )
				.then( decryptedText => {
					if ( decryptedText != null ){
						this.currentEditorSourceText = decryptedText;
						this.refreshView( EncryptedFileContentViewStateEnum.editNote );
						new Notice('Decrypted using remembered password', 2000);
					}
				})
			;
		}

	}

	private async encodeAndSave( ){
		try{

			//console.debug('encodeAndSave', {currentEditorSourceText:this.currentEditorSourceText});
			
			const fileData = await FileDataHelper.encode(
				this.encryptionPassword,
				this.hint,
				this.currentEditorSourceText
			);
			
			this.data = JsonFileEncoding.encode(fileData);
			
			this.requestSave();
		} catch(e){
			console.error(e);
			new Notice(e, 10000);
		}
	}

	private addEditorSourceView( container: HTMLElement ) {

		this.elActionReadingView.show();
		this.elActionIconLockNote.show();
		this.elActionChangePassword.show();

		this.addHeader( container, 'Editing an encrypted note');

		// build source view
		const editorContainer = container.createDiv( { cls:'editor-source-view' } );
		editorContainer.spellcheck = true;
		editorContainer.autocapitalize = 'on';
		editorContainer.translate = false;
		editorContainer.contentEditable = 'plaintext-only';
		//console.debug( 'addEditorSourceView', {currentEditorSourceText:this.currentEditorSourceText} );
		editorContainer.innerText = this.currentEditorSourceText;


		editorContainer.focus();

		editorContainer.on('input', '*', async (ev, target) =>{
			this.currentEditorSourceText = editorContainer.innerText;
			await this.encodeAndSave();
		});
	
	}

	private addEditorReadingView( container: HTMLElement ) {

		this.elActionEditView.show();
		this.elActionIconLockNote.show();
		this.elActionChangePassword.show();

		this.addHeader( container, 'Reading an encrypted note' );

		const readingContainer = container.createDiv({cls:'editor-reading-view'});


		// build reading view
		MarkdownRenderer.renderMarkdown(
			this.currentEditorSourceText,
			readingContainer,
			this.file.path,
			this
		).catch( reason => {
			console.error( reason );
		});
		
	}

	private addUserInputContainer( container: HTMLElement ) : HTMLElement{
		return container.createDiv({cls: 'input-container' });
	}

	private addChangePasswordView( container: HTMLElement ) {

		this.addHeader( container, 'Change encrypted note password' );

		const inputContainer = this.addUserInputContainer( container );

		let newPassword = '';
		let confirm = '';
		let newHint = '';

		const submit = async (newPassword: string, confirm: string, newHint:string) => {
			const validPw = this.validatePassword(newPassword);
			const validCpw = this.validateConfirm(newPassword, confirm);
			sNewPassword.setDesc( validPw );
			sConfirm.setDesc( validCpw );

			if ( validPw.length === 0 && validCpw.length === 0 ){
				//set password and hint and open note
				//console.debug('createChangePasswordView submit');
				this.encryptionPassword = newPassword;
				this.hint = newHint;

				this.encodeAndSave();
				this.refreshView( EncryptedFileContentViewStateEnum.editNote );

				SessionPasswordService.putByFile( {password: newPassword, hint: newHint}, this.file );

				new Notice('Password and Hint were changed');
			}
		}

		const sNewPassword = UiHelper.buildPasswordSetting({
			container: inputContainer,
			name: 'New Password:',
			autoFocus: true,
			onChangeCallback: (value) =>{
				newPassword = value;
				sNewPassword.setDesc( this.validatePassword(newPassword) );
				sConfirm.setDesc( this.validateConfirm(newPassword, confirm) );
			},
			onEnterCallback: (value) =>{
				newPassword = value;
				if (newPassword.length > 0){
					sConfirm.controlEl.querySelector('input')?.focus();
				}
			}
		});

		const sConfirm = UiHelper.buildPasswordSetting({
			container: inputContainer,
			name: 'Confirm:',
			onChangeCallback: (value) =>{
				confirm = value;
				sNewPassword.setDesc( this.validatePassword(newPassword) );
				sConfirm.setDesc( this.validateConfirm(newPassword, confirm) );
			},
			onEnterCallback: (value) =>{
				confirm = value;
				// validate confirm
				const passwordMatch = newPassword === confirm;
				if (passwordMatch){
					sHint.controlEl.querySelector('input')?.focus();
				}
			}
		});

		const sHint = new Setting(inputContainer)
			.setName("New Hint:")
			.addText((tc) =>{
				tc.onChange( v => {
					newHint = v;
				});
			})
		;
		sHint.controlEl.on('keydown', '*', (ev) =>{
			if ( ev.key === 'Enter' ) {
				ev.preventDefault();
				submit(newPassword, confirm, newHint);
			}
		});

		new Setting(inputContainer)
				.addButton( bc => {
				bc
					.removeCta()
					.setIcon('cross')
					//.setButtonText('Cancel')
					.setTooltip('Cancel')
					.onClick( () => {
						this.refreshView( EncryptedFileContentViewStateEnum.editNote );
					} )
				;
			}).addButton( bc => {
				bc
					.setCta()
					.setIcon('checkmark')
					.setTooltip('Change Password')
					//.setButtonText('Change Password')
					.setWarning()
					.onClick( (ev) => {
						submit(newPassword, confirm, newHint);
					} )
				;
			})
		;
	}

	private formatHint( hint:string ): string{
		if (hint.length > 0){
			return `Hint: ${hint}`;
		}else{
			return '';
		}
	}

	private refreshView(
		newView: EncryptedFileContentViewStateEnum
	){

		this.currentView = newView;


		//console.debug('refreshView',{'currentView':this.currentView, newView});
		this.elActionEditView.hide();
		this.elActionReadingView.hide();
		this.elActionIconLockNote.hide();
		this.elActionChangePassword.hide();

		// clear view
		this.contentEl.empty();
		if ( ObsidianEx.readableLineLength ){
			this.contentEl.classList.add('is-readable-line-width');
		}else{
			this.contentEl.classList.remove('is-readable-line-width');
		}
		
		const contentContainer = this.contentEl.createDiv({cls: 'content-container'});

		switch (this.currentView) {
			case EncryptedFileContentViewStateEnum.newNote:
				this.addNewNoteView( contentContainer );
			break;

			case EncryptedFileContentViewStateEnum.decryptNote:
				this.addDecryptNoteView( contentContainer );
			break;
			
			case EncryptedFileContentViewStateEnum.editNote:
				if ( this.currentEditNoteMode == EditViewEnum.source ){
					this.addEditorSourceView( contentContainer );
				} else{
					// default to reading
					this.addEditorReadingView( contentContainer );
				}
			break;

			case EncryptedFileContentViewStateEnum.changePassword:
				this.addChangePasswordView( contentContainer );
			break;
		}

	}

	async decryptWithPassword( pw: string ) : Promise<string | null>{
		// if ( pw.length == 0 ){
		// 	return null;
		// }
		const fileData = JsonFileEncoding.decode( this.data );
		const decryptedText = await FileDataHelper.decrypt( fileData, pw );
		return decryptedText;
	}

	async handleDecryptButtonClick() {
		const decryptedText = await this.decryptWithPassword( this.encryptionPassword );

		if (decryptedText === null){
			new Notice('Decryption failed');
		}else{
			SessionPasswordService.putByFile( {password: this.encryptionPassword, hint: this.hint }, this.file );
			this.currentEditorSourceText = decryptedText;
			this.refreshView( EncryptedFileContentViewStateEnum.editNote);
		}

	}

	// important
	canAcceptExtension(extension: string): boolean {
		//console.debug('EncryptedFileContentView.canAcceptExtension', {extension});
		return extension == ENCRYPTED_FILE_EXTENSION;
	}

	// important
	getViewType() {
		return VIEW_TYPE_ENCRYPTED_FILE_CONTENT;
	}

	// the data to show on the view
	override setViewData(data: string, clear: boolean): void {
		// console.debug('EncryptedFileContentView.setViewData', {
		// 	data,
		// 	clear,
		// 	'pass':this.encryptionPassword,
		// 	//'mode':this.getMode(),
		// 	//'mode-data':this.currentMode.get(),
		// 	//'preview-mode-data':this.previewMode.get()
		// });

		if (clear){

			let newView : EncryptedFileContentViewStateEnum;
			if (data === ''){
				// blank new file
				newView = EncryptedFileContentViewStateEnum.newNote;
			}else{
				newView = EncryptedFileContentViewStateEnum.decryptNote;
			}
			
			// new file, we don't know what the password is yet
			this.encryptionPassword = '';

			// json decode file data to get the Hint
			const fileData = JsonFileEncoding.decode(this.data);
			
			this.hint = fileData.hint;
			
			this.refreshView( newView );

		}else{
			this.leaf.detach();
			new Notice('Multiple views of the same encrypted note isn\'t supported');
		}
		
	}

	// the data to save to disk
	override getViewData(): string {
		// console.debug('EncryptedFileContentView.getViewData', {
		// 	'this':this,
		// 	'data':this.data,
		// });
		
		return this.data;
	}

	override clear(): void {
		//console.debug('EncryptedFileContentView.clear');
	}


}
