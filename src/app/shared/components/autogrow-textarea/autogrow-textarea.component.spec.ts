import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AutogrowTextareaComponent } from './autogrow-textarea.component';
import { By } from '@angular/platform-browser';

describe('AutogrowTextareaComponent', () => {
  let component: AutogrowTextareaComponent;
  let fixture: ComponentFixture<AutogrowTextareaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutogrowTextareaComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(AutogrowTextareaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render textarea with default empty value', () => {
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea).toBeTruthy();
    expect(textarea.nativeElement.value).toBe('');
  });

  it('should display the provided value', () => {
    // Use setInput for OnPush change detection
    fixture.componentRef.setInput('value', 'Test content');
    fixture.detectChanges();
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.value).toBe('Test content');
  });

  it('should handle undefined value gracefully', () => {
    fixture.componentRef.setInput('value', undefined);
    fixture.detectChanges();
    expect(component.displayValue).toBe('');
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.value).toBe('');
  });

  it('should set placeholder attribute', () => {
    fixture.componentRef.setInput('placeholder', 'Enter text...');
    fixture.detectChanges();
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.placeholder).toBe('Enter text...');
  });

  it('should set min-height style', () => {
    fixture.componentRef.setInput('minHeight', '100px');
    fixture.detectChanges();
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.style.minHeight).toBe('100px');
  });

  it('should set max-height style', () => {
    fixture.componentRef.setInput('maxHeight', '300px');
    fixture.detectChanges();
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.style.maxHeight).toBe('300px');
  });

  it('should emit valueChange on input', () => {
    const spy = spyOn(component.valueChange, 'emit');
    const textarea = fixture.debugElement.query(By.css('textarea'));

    textarea.nativeElement.value = 'New value';
    textarea.nativeElement.dispatchEvent(new Event('input'));

    expect(spy).toHaveBeenCalledWith('New value');
  });

  it('should update data attribute for CSS mirroring with trailing newline', () => {
    fixture.componentRef.setInput('value', 'Mirror test');
    fixture.detectChanges();

    const growWrap = fixture.debugElement.query(By.css('.grow-wrap'));
    // mirrorValue adds a trailing newline for proper expansion
    expect(growWrap.nativeElement.getAttribute('data-replicated-value')).toBe('Mirror test\n');
  });

  it('should set disabled attribute when disabled is true', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.disabled).toBeTrue();
  });

  it('should set readonly attribute when readonly is true', () => {
    fixture.componentRef.setInput('readonly', true);
    fixture.detectChanges();
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.readOnly).toBeTrue();
  });

  it('should set aria-label when provided', () => {
    fixture.componentRef.setInput('ariaLabel', 'Description field');
    fixture.detectChanges();
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.getAttribute('aria-label')).toBe('Description field');
  });

  it('should set aria-labelledby when provided', () => {
    fixture.componentRef.setInput('ariaLabelledBy', 'label-id');
    fixture.detectChanges();
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.getAttribute('aria-labelledby')).toBe('label-id');
  });

  it('should not set aria attributes when not provided', () => {
    const textarea = fixture.debugElement.query(By.css('textarea'));
    expect(textarea.nativeElement.getAttribute('aria-label')).toBeNull();
    expect(textarea.nativeElement.getAttribute('aria-labelledby')).toBeNull();
  });
});
